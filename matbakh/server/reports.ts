import { and, gte, inArray, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { branches, kitchenOrderItems, kitchenOrders, staffUsers } from "../drizzle/schema";
import { getDb } from "./db";

export type ReportShift = "morning" | "evening";
export type ReportInput = { from: Date; to: Date; branchId?: number | null; shift?: ReportShift | null; tzOffsetMinutes: number };

const MORNING_END_HOUR = 15;
const MAX_RANGE_DAYS = 92;
const MAX_DETAIL_ROWS = 500;

const minutesBetween = (start: Date | null, end: Date | null) =>
  start && end ? Math.max(0, (end.getTime() - start.getTime()) / 60000) : null;
const average = (values: Array<number | null>) => {
  const list = values.filter((value): value is number => value != null);
  return list.length ? Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10 : null;
};
const percent = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);

function localParts(date: Date, tzOffsetMinutes: number) {
  const local = new Date(date.getTime() - tzOffsetMinutes * 60000);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

/** Admin/developer analytics: totals, lateness, prep times by branch, shift, day and hour. */
export async function operationsAnalytics(input: ReportInput) {
  if (!(input.from < input.to) || input.to.getTime() - input.from.getTime() > MAX_RANGE_DAYS * 86400000)
    throw new TRPCError({ code: "BAD_REQUEST", message: `اختر فترة صحيحة لا تتجاوز ${MAX_RANGE_DAYS} يومًا.` });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة حاليًا." });
  const now = new Date();
  const conditions = [gte(kitchenOrders.createdAt, input.from), lt(kitchenOrders.createdAt, input.to)];
  const [branchRows, orderRows] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).orderBy(branches.id),
    db.select({
      id: kitchenOrders.id, code: kitchenOrders.orderCode, branchId: kitchenOrders.branchId, status: kitchenOrders.status,
      createdById: kitchenOrders.createdById, createdByName: kitchenOrders.createdByName, createdAt: kitchenOrders.createdAt,
      acceptedAt: kitchenOrders.acceptedAt, readyAt: kitchenOrders.readyAt, receivedAt: kitchenOrders.receivedAt,
      extensionMinutes: kitchenOrders.extensionMinutes, effectiveDueAt: kitchenOrders.effectiveDueAt, everOverdue: kitchenOrders.everOverdue,
    }).from(kitchenOrders).where(and(...conditions)),
  ]);
  const scoped = input.branchId ? orderRows.filter(order => order.branchId === input.branchId) : orderRows;
  const creatorIds = Array.from(new Set(scoped.map(order => order.createdById).filter((id): id is number => id != null)));
  const [creators, items] = await Promise.all([
    creatorIds.length ? db.select({ id: staffUsers.id, usualShift: staffUsers.usualShift }).from(staffUsers).where(inArray(staffUsers.id, creatorIds)) : Promise.resolve([]),
    scoped.length ? db.select({ orderId: kitchenOrderItems.orderId, productName: kitchenOrderItems.productName, quantity: kitchenOrderItems.quantity }).from(kitchenOrderItems).where(inArray(kitchenOrderItems.orderId, scoped.map(order => order.id))) : Promise.resolve([]),
  ]);
  const shiftByUser = new Map(creators.map(creator => [creator.id, creator.usualShift]));
  const branchName = new Map(branchRows.map(branch => [branch.id, branch.name]));
  const itemsByOrder = new Map<number, typeof items>();
  for (const item of items) itemsByOrder.set(item.orderId, [...(itemsByOrder.get(item.orderId) ?? []), item]);

  const rows = scoped.map(order => {
    const { day, hour } = localParts(order.createdAt, input.tzOffsetMinutes);
    const creatorShift = order.createdById ? shiftByUser.get(order.createdById) : null;
    const shift: ReportShift = creatorShift === "morning" || creatorShift === "evening" ? creatorShift : hour < MORNING_END_HOUR ? "morning" : "evening";
    const late = Boolean(order.everOverdue) || (order.status === "preparing" && Boolean(order.effectiveDueAt) && order.effectiveDueAt! < now);
    const orderItems = itemsByOrder.get(order.id) ?? [];
    return {
      ...order, day, hour, shift, late,
      waitMinutes: minutesBetween(order.createdAt, order.acceptedAt),
      prepMinutes: minutesBetween(order.acceptedAt, order.readyAt),
      quantity: orderItems.reduce((sum, item) => sum + item.quantity, 0),
      items: orderItems,
    };
  }).filter(row => !input.shift || row.shift === input.shift);

  const summarize = (list: typeof rows) => {
    const late = list.filter(row => row.late).length;
    return {
      orders: list.length,
      quantity: list.reduce((sum, row) => sum + row.quantity, 0),
      late,
      latePct: percent(late, list.length),
      onTimePct: list.length ? Math.round((100 - percent(late, list.length)) * 10) / 10 : 0,
      extended: list.filter(row => row.extensionMinutes > 0).length,
      avgWaitMinutes: average(list.map(row => row.waitMinutes)),
      avgPrepMinutes: average(list.map(row => row.prepMinutes)),
    };
  };
  const statusCounts = { new: 0, preparing: 0, ready: 0, received: 0 };
  for (const row of rows) statusCounts[row.status] += 1;

  const days: string[] = [];
  for (let cursor = new Date(input.from); cursor < input.to; cursor = new Date(cursor.getTime() + 86400000)) {
    const day = localParts(cursor, input.tzOffsetMinutes).day;
    if (!days.includes(day)) days.push(day);
  }
  const products = new Map<string, number>();
  for (const row of rows) for (const item of row.items) products.set(item.productName, (products.get(item.productName) ?? 0) + item.quantity);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const visibleBranches = input.branchId ? branchRows.filter(branch => branch.id === input.branchId) : branchRows;

  return {
    generatedAt: now.toISOString(),
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    summary: { ...summarize(rows), statusCounts },
    byShift: (["morning", "evening"] as const).map(shift => ({ shift, ...summarize(rows.filter(row => row.shift === shift)) })),
    byBranch: visibleBranches.map(branch => {
      const list = rows.filter(row => row.branchId === branch.id);
      return {
        id: branch.id, name: branch.name, ...summarize(list),
        morning: summarize(list.filter(row => row.shift === "morning")),
        evening: summarize(list.filter(row => row.shift === "evening")),
      };
    }),
    byDay: days.map(day => {
      const list = rows.filter(row => row.day === day);
      return { day, orders: list.length, late: list.filter(row => row.late).length };
    }),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orders: rows.filter(row => row.hour === hour).length })),
    topProducts: [...products.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, quantity]) => ({ name, quantity, pct: percent(quantity, totalQuantity) })),
    orders: rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, MAX_DETAIL_ROWS).map(row => ({
      id: row.id, code: row.code, branch: row.branchId ? branchName.get(row.branchId) ?? "—" : "—", shift: row.shift,
      status: row.status, createdAt: row.createdAt.toISOString(), createdByName: row.createdByName,
      waitMinutes: row.waitMinutes == null ? null : Math.round(row.waitMinutes * 10) / 10,
      prepMinutes: row.prepMinutes == null ? null : Math.round(row.prepMinutes * 10) / 10,
      extensionMinutes: row.extensionMinutes, late: row.late,
      items: row.items.map(item => `${item.productName} × ${item.quantity}`).join("، "),
    })),
    truncated: rows.length > MAX_DETAIL_ROWS,
  };
}
