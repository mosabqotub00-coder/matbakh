import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";
import { branches, dataMigrationJournal, kitchenOrderEvents, kitchenOrderItems, kitchenOrders, products, staffUsers } from "../drizzle/schema";
import { historicPreparationDueAt, isOverdue } from "../shared/order-time";
import type { StaffRole } from "../shared/roles";
import { getDb } from "../server/db";

// This legacy conversion is not a general-purpose restore command.
if (!process.argv.includes("--legacy-to-faisal")) {
  throw new Error("Legacy migration requires an explicit --legacy-to-faisal flag after a backup and branch mapping review. No data changed.");
}

const MARKER = "v2-branch-assignment-and-product-clones";
const BRANCH_SEED = [
  { name: "فرع سفيان", city: "نابلس", ordersEnabled: true },
  { name: "فرع فيصل", city: "نابلس", ordersEnabled: true },
  { name: "فرع رفيديا", city: "نابلس", ordersEnabled: false },
  { name: "فرع بلازا مول", city: "رام الله", ordersEnabled: true },
  { name: "فرع الطيرة", city: "رام الله", ordersEnabled: true },
] as const;

function roleAndFlags(account: typeof staffUsers.$inferSelect) {
  let role: StaffRole;
  if (account.username.normalize("NFKC").trim().toLocaleLowerCase("en-US") === "manager") role = "system_admin";
  else if (account.role && account.role !== "station") role = account.role;
  else if (account.canManager) role = "shift_manager";
  else if (account.canStation && account.canKitchen) role = "kitchen_manager";
  else if (account.canStation) role = "station";
  else role = "kitchen";
  const roleName: string = role;
  const flags = {
    canStation: roleName === "system_admin" || roleName === "kitchen_manager" || roleName === "station",
    canKitchen: roleName === "system_admin" || roleName === "kitchen_manager" || roleName === "kitchen",
    canManager: roleName === "system_admin" || roleName === "branch_manager" || roleName === "kitchen_manager" || roleName === "shift_manager",
    canManageUsers: roleName === "system_admin" || roleName === "branch_manager",
    canBroadcast: roleName === "system_admin" || roleName === "branch_manager" || roleName === "kitchen_manager" || roleName === "shift_manager",
    canExtend: roleName === "system_admin" || roleName === "kitchen_manager",
  };
  return { role, flags };
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available.");
  await db.transaction(async tx => {
    const [alreadyApplied] = await tx.select().from(dataMigrationJournal).where(eq(dataMigrationJournal.marker, MARKER)).limit(1);
    if (alreadyApplied) {
      console.info(`Migration marker ${MARKER} already exists; no rows changed.`);
      return;
    }

    const seeded = new Map<string, typeof branches.$inferSelect>();
    for (const seed of BRANCH_SEED) {
      const [existing] = await tx.select().from(branches).where(and(eq(branches.name, seed.name), eq(branches.city, seed.city))).limit(1);
      if (existing) seeded.set(seed.name, existing);
      else {
        const result = await tx.insert(branches).values({ ...seed, isLegacy: false });
        const [created] = await tx.select().from(branches).where(eq(branches.id, Number(result[0].insertId))).limit(1);
        if (!created) throw new Error(`Unable to seed branch ${seed.name}`);
        seeded.set(seed.name, created);
      }
    }
    const faisal = seeded.get("فرع فيصل");
    if (!faisal) throw new Error("Faisal branch was not created.");

    // Existing products and orders are assigned once. This does not touch rows
    // already explicitly assigned by a prior operator.
    await tx.update(products).set({ branchId: faisal.id }).where(isNull(products.branchId));
    await tx.update(kitchenOrders).set({ branchId: faisal.id }).where(isNull(kitchenOrders.branchId));
    await tx.update(kitchenOrderItems).set({ graceMinutes: 5 }).where(isNull(kitchenOrderItems.graceMinutes));

    const currentProducts = await tx.select().from(products).where(eq(products.branchId, faisal.id));
    const otherBranches = [...seeded.values()].filter(branch => branch.id !== faisal.id);
    for (const branch of otherBranches) {
      const existingProducts = await tx.select({ name: products.name }).from(products).where(eq(products.branchId, branch.id));
      const existingNames = new Set(existingProducts.map(row => row.name));
      for (const product of currentProducts) {
        // Insert-only clone: branch-local edits are never overwritten.
        if (existingNames.has(product.name)) continue;
        await tx.insert(products).values({
          branchId: branch.id,
          name: product.name,
          category: product.category,
          prepMinutes: product.prepMinutes,
          graceMinutes: product.graceMinutes,
          hasTimer: product.hasTimer,
          isActive: product.isActive,
          sortOrder: product.sortOrder,
        });
      }
    }

    const accounts = await tx.select().from(staffUsers).orderBy(staffUsers.id).for("update");
    for (const account of accounts) {
      // Never move existing branch accounts or reclassify modern global accounts.
      if (account.branchId != null || ["developer", "system_admin"].includes(account.role)) continue;
      const { role, flags } = roleAndFlags(account);
      await tx.update(staffUsers).set({ role, branchId: role === "system_admin" ? null : faisal.id, ...flags }).where(eq(staffUsers.id, account.id));
    }

    // Backfill timing from the old preparation deadline. No grace period is
    // invented for historic overdue calculations and ready rows remain ready
    // (awaiting receipt) because there is no truthful receipt timestamp.
    const orders = await tx.select().from(kitchenOrders).where(eq(kitchenOrders.branchId, faisal.id));
    for (const order of orders) {
      if (!order.acceptedAt) continue;
      const [item] = await tx.select({ prepMinutes: kitchenOrderItems.prepMinutes }).from(kitchenOrderItems).where(eq(kitchenOrderItems.orderId, order.id)).limit(1);
      if (!item) continue;
      const dueAt = historicPreparationDueAt(order.acceptedAt, item.prepMinutes, order.extensionMinutes);
      if (!dueAt) continue;
      await tx.update(kitchenOrders).set({
        originalDueAt: order.originalDueAt ?? dueAt,
        effectiveDueAt: order.effectiveDueAt ?? dueAt,
        // A preparing row can already have crossed its historic deadline at
        // migration time; preserve that fact instead of waiting for readyAt.
        everOverdue: order.everOverdue || isOverdue(order.readyAt ?? new Date(), dueAt),
      }).where(eq(kitchenOrders.id, order.id));
    }

    const oldEvents = await tx.select().from(kitchenOrderEvents);
    for (const event of oldEvents) {
      const kind = event.status === "preparing" ? "accepted" : event.status === "ready" ? "ready" : event.status === "received" ? "received" : "created";
      await tx.update(kitchenOrderEvents).set({ kind }).where(eq(kitchenOrderEvents.id, event.id));
    }

    await tx.insert(dataMigrationJournal).values({
      marker: MARKER,
      details: JSON.stringify({ assignedBranch: faisal.id, branches: [...seeded.values()].map(branch => branch.id), productCloneSource: faisal.id }),
    });
  });
  console.info("v2 branch assignment and product clone migration completed.");
}

main().then(() => process.exit(0)).catch(error => {
  console.error("v2 data migration failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
