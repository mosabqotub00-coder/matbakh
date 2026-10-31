import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { branches, type Branch } from "../drizzle/schema";
import { isSystemAdmin, roleOf, type StaffLike } from "../shared/roles";
import { getDb } from "./db";

export type BranchActor = StaffLike & { id: number; displayName?: string };

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
  return db;
}

export function assertSystemAdmin(actor: StaffLike | null | undefined) {
  if (!isSystemAdmin(actor)) throw new TRPCError({ code: "FORBIDDEN", message: "هذا الإجراء متاح لمدير النظام الأعلى فقط." });
}

/** Resolve the effective branch without allowing a worker to choose another branch. */
export function resolveBranchId(actor: BranchActor, requestedBranchId?: number | null) {
  if (isSystemAdmin(actor)) {
    if (requestedBranchId == null) throw new TRPCError({ code: "BAD_REQUEST", message: "اختر الفرع أولاً." });
    return requestedBranchId;
  }
  if (actor.branchId == null) throw new TRPCError({ code: "FORBIDDEN", message: "الحساب غير مرتبط بفرع." });
  if (requestedBranchId != null && requestedBranchId !== actor.branchId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "لا يمكنك الوصول إلى بيانات فرع آخر." });
  }
  return actor.branchId;
}

export function optionalBranchFilter(actor: BranchActor, requestedBranchId?: number | null) {
  if (isSystemAdmin(actor)) return requestedBranchId == null ? null : requestedBranchId;
  return resolveBranchId(actor, requestedBranchId);
}

export async function getBranch(branchId: number) {
  const db = await requireDb();
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch) throw new TRPCError({ code: "NOT_FOUND", message: "الفرع غير موجود." });
  return branch;
}

export async function listBranches(actor: BranchActor) {
  const db = await requireDb();
  const rows = await db.select().from(branches).orderBy(asc(branches.city), asc(branches.name));
  if (isSystemAdmin(actor)) return rows;
  if (actor.branchId == null) return [];
  return rows.filter(branch => branch.id === actor.branchId);
}

export async function createBranch(actor: BranchActor, input: { name: string; city: string; ordersEnabled: boolean }) {
  assertSystemAdmin(actor);
  const db = await requireDb();
  const name = input.name.trim();
  const city = input.city.trim();
  if (!name || !city) throw new TRPCError({ code: "BAD_REQUEST", message: "اسم الفرع والمدينة مطلوبان." });
  try {
    const result = await db.insert(branches).values({ name, city, ordersEnabled: input.ordersEnabled, isLegacy: false });
    const [created] = await db.select().from(branches).where(eq(branches.id, Number(result[0].insertId))).limit(1);
    return created;
  } catch (error) {
    if (String(error).toLowerCase().includes("duplicate")) throw new TRPCError({ code: "CONFLICT", message: "الفرع موجود بالفعل." });
    throw error;
  }
}

export async function updateBranch(actor: BranchActor, input: { id: number; name?: string; city?: string; ordersEnabled?: boolean }) {
  assertSystemAdmin(actor);
  const db = await requireDb();
  const changes: Partial<typeof branches.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name.trim();
  if (input.city !== undefined) changes.city = input.city.trim();
  if (input.ordersEnabled !== undefined) changes.ordersEnabled = input.ordersEnabled;
  if (!Object.keys(changes).length) throw new TRPCError({ code: "BAD_REQUEST", message: "أرسل حقلًا واحدًا على الأقل للتعديل." });
  const result = await db.update(branches).set(changes).where(eq(branches.id, input.id));
  if (result[0].affectedRows !== 1) throw new TRPCError({ code: "NOT_FOUND", message: "الفرع غير موجود." });
  return getBranch(input.id);
}

export async function assertBranchOrdersEnabled(branchId: number) {
  const branch = await getBranch(branchId);
  if (!branch.ordersEnabled) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "استقبال الطلبات متوقف لهذا الفرع." });
  return branch;
}

export function isBranchScopedManager(actor: BranchActor) {
  return roleOf(actor) === "branch_manager";
}
