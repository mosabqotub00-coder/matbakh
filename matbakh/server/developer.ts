import { desc, eq, gte, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { branches, developerErrors, featureFlags, kitchenOrderItems, kitchenOrders, products, releaseManifests, staffFeedback, staffUsers } from "../drizzle/schema";
import { getDb } from "./db";
import { isDeveloper, type StaffLike } from "../shared/roles";

type DeveloperActor = StaffLike & { id: number; branchId: number | null };
const execFileAsync = promisify(execFile);

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة حاليًا." });
  return db;
}

function assertDeveloper(user: StaffLike) {
  if (!isDeveloper(user)) throw new TRPCError({ code: "FORBIDDEN", message: "مركز المطوّر متاح لحساب المطوّر فقط." });
}

export async function reportDeveloperError(input: {
  branchId?: number | null;
  userId?: number | null;
  severity?: "info" | "warning" | "error" | "critical";
  source: string;
  message: string;
  route?: string | null;
  details?: string | null;
}) {
  const db = await requireDb();
  await db.insert(developerErrors).values({
    branchId: input.branchId ?? null,
    userId: input.userId ?? null,
    severity: input.severity ?? "error",
    source: input.source.slice(0, 80),
    message: input.message.slice(0, 5000),
    route: input.route?.slice(0, 255) ?? null,
    details: input.details?.slice(0, 10000) ?? null,
  });
  return { success: true } as const;
}

export async function developerDashboard(user: DeveloperActor) {
  assertDeveloper(user);
  const db = await requireDb();
  const [errors, feedback, releases, flags] = await Promise.all([
    db.select({ id: developerErrors.id, branchId: developerErrors.branchId, severity: developerErrors.severity, source: developerErrors.source, message: developerErrors.message, route: developerErrors.route, status: developerErrors.status, createdAt: developerErrors.createdAt }).from(developerErrors).orderBy(desc(developerErrors.createdAt)).limit(80),
    db.select({ id: staffFeedback.id, branchId: staffFeedback.branchId, userId: staffFeedback.userId, orderId: staffFeedback.orderId, title: staffFeedback.title, description: staffFeedback.description, priority: staffFeedback.priority, attachmentName: staffFeedback.attachmentName, attachmentType: staffFeedback.attachmentType, status: staffFeedback.status, createdAt: staffFeedback.createdAt, updatedAt: staffFeedback.updatedAt }).from(staffFeedback).orderBy(desc(staffFeedback.createdAt)).limit(80),
    db.select({ id: releaseManifests.id, version: releaseManifests.version, title: releaseManifests.title, notes: releaseManifests.notes, artifactName: releaseManifests.artifactName, artifactSize: releaseManifests.artifactSize, status: releaseManifests.status, target: releaseManifests.target, targetBranchId: releaseManifests.targetBranchId, createdAt: releaseManifests.createdAt, updatedAt: releaseManifests.updatedAt }).from(releaseManifests).orderBy(desc(releaseManifests.createdAt)).limit(50),
    db.select().from(featureFlags).orderBy(desc(featureFlags.updatedAt)).limit(100),
  ]);
  return { errors, feedback, releases, flags };
}

export async function developerOperationsReport(
  user: DeveloperActor,
  period: "today" | "7days" | "30days" = "today"
) {
  assertDeveloper(user);
  const db = await requireDb();
  const now = new Date();
  const from = new Date(now);
  if (period === "today") from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - (period === "7days" ? 7 : 30));
  const [branchRows, orderRows, errorRows, feedbackRows] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).orderBy(branches.id),
    db.select({ id: kitchenOrders.id, branchId: kitchenOrders.branchId, everOverdue: kitchenOrders.everOverdue, createdAt: kitchenOrders.createdAt }).from(kitchenOrders).where(gte(kitchenOrders.createdAt, from)),
    db.select({ branchId: developerErrors.branchId }).from(developerErrors).where(gte(developerErrors.createdAt, from)),
    db.select({ branchId: staffFeedback.branchId }).from(staffFeedback).where(gte(staffFeedback.createdAt, from)),
  ]);
  const orderIds = orderRows.map(order => order.id);
  const itemRows = orderIds.length
    ? await db.select({ orderId: kitchenOrderItems.orderId, productName: kitchenOrderItems.productName, quantity: kitchenOrderItems.quantity }).from(kitchenOrderItems).where(inArray(kitchenOrderItems.orderId, orderIds))
    : [];
  const ordersById = new Map(orderRows.map(order => [order.id, order]));
  return {
    period,
    from: from.toISOString(),
    generatedAt: now.toISOString(),
    branches: branchRows.map(branch => {
      const branchOrders = orderRows.filter(order => order.branchId === branch.id);
      const branchItems = itemRows.filter(item => ordersById.get(item.orderId)?.branchId === branch.id);
      const productsByName = new Map<string, number>();
      for (const item of branchItems) productsByName.set(item.productName, (productsByName.get(item.productName) ?? 0) + item.quantity);
      return {
        id: branch.id,
        name: branch.name,
        orderCount: branchOrders.length,
        quantity: branchItems.reduce((sum, item) => sum + item.quantity, 0),
        lateCount: branchOrders.filter(order => Boolean(order.everOverdue)).length,
        errorCount: errorRows.filter(error => error.branchId === branch.id).length,
        feedbackCount: feedbackRows.filter(feedback => feedback.branchId === branch.id).length,
        topProducts: [...productsByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
      };
    }),
  };
}

export async function runDeveloperSystemCheck(user: DeveloperActor) {
  assertDeveloper(user);
  const db = await requireDb();
  const checks: Array<{ name: string; status: "passed" | "warning" | "failed"; detail: string }> = [];
  const run = async (name: string, task: () => Promise<number>, emptyDetail: string) => {
    try {
      const count = await task();
      checks.push({ name, status: count > 0 ? "passed" : "warning", detail: count > 0 ? `تم الاتصال ووجد النظام ${count} سجلًا.` : emptyDetail });
    } catch {
      checks.push({ name, status: "failed", detail: "تعذر تنفيذ الاختبار على قاعدة البيانات الحالية." });
    }
  };
  await run("اتصال قاعدة البيانات", async () => (await db.select({ id: staffUsers.id }).from(staffUsers).limit(1)).length, "قاعدة البيانات متاحة لكن لا توجد حسابات.");
  await run("الفروع والحسابات", async () => (await db.select({ id: branches.id }).from(branches).limit(1)).length, "لم يتم العثور على فروع؛ راجع بيانات التشغيل.");
  await run("الأصناف", async () => (await db.select({ id: products.id }).from(products).limit(1)).length, "لم يتم العثور على أصناف اختبارية.");
  await run("دورة الطلبات", async () => (await db.select({ id: kitchenOrders.id }).from(kitchenOrders).limit(1)).length, "لا توجد طلبات سابقة؛ يمكن تجربة طلب جديد يدويًا.");
  return { ranAt: new Date().toISOString(), checks, safe: checks.every(check => check.status !== "failed") };
}

export async function createFeedback(user: DeveloperActor, input: { title: string; description: string; branchId?: number | null; orderId?: number | null; priority?: "low" | "normal" | "high" | "urgent"; attachmentBase64?: string | null; attachmentName?: string | null; attachmentType?: string | null }) {
  const db = await requireDb();
  const encoded = input.attachmentBase64?.replace(/^data:[^;]+;base64,/, "") ?? "";
  if (encoded.length > 7_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "المرفق أكبر من الحد المسموح." });
  await db.insert(staffFeedback).values({
    branchId: input.branchId ?? user.branchId ?? null,
    userId: user.id,
    orderId: input.orderId ?? null,
    title: input.title.trim().slice(0, 160),
    description: input.description.trim().slice(0, 10000),
    priority: input.priority ?? "normal",
    attachmentData: encoded ? Buffer.from(encoded, "base64") : null,
    attachmentName: input.attachmentName?.slice(0, 160) ?? null,
    attachmentType: input.attachmentType?.slice(0, 120) ?? null,
  });
  return { success: true } as const;
}

export async function updateDeveloperIssue(user: DeveloperActor, input: { kind: "error" | "feedback"; id: number; status: "new" | "investigating" | "resolved" | "ignored" | "closed" }) {
  assertDeveloper(user);
  const db = await requireDb();
  const now = new Date();
  if (input.kind === "error") {
    await db.update(developerErrors).set({ status: input.status as "new" | "investigating" | "resolved" | "ignored", resolvedAt: ["resolved", "ignored"].includes(input.status) ? now : null, resolvedById: ["resolved", "ignored"].includes(input.status) ? user.id : null }).where(eq(developerErrors.id, input.id));
  } else {
    await db.update(staffFeedback).set({ status: input.status as "new" | "investigating" | "resolved" | "closed", resolvedById: ["resolved", "closed"].includes(input.status) ? user.id : null }).where(eq(staffFeedback.id, input.id));
  }
  return { success: true } as const;
}

export async function getFeedbackAttachment(user: DeveloperActor, feedbackId: number) {
  assertDeveloper(user);
  const db = await requireDb();
  const [feedback] = await db.select({ attachmentData: staffFeedback.attachmentData, attachmentName: staffFeedback.attachmentName, attachmentType: staffFeedback.attachmentType }).from(staffFeedback).where(eq(staffFeedback.id, feedbackId)).limit(1);
  if (!feedback?.attachmentData) throw new TRPCError({ code: "NOT_FOUND", message: "المرفق غير موجود أو تعذر قراءته." });
  const data = Buffer.from(feedback.attachmentData).toString("base64");
  return { name: feedback.attachmentName ?? "مرفق الملاحظة", type: feedback.attachmentType ?? "application/octet-stream", dataUrl: `data:${feedback.attachmentType ?? "application/octet-stream"};base64,${data}` };
}

export async function upsertFeatureFlag(user: DeveloperActor, input: { id?: number; featureKey: string; displayName: string; description?: string | null; target: "developer" | "branch" | "all"; branchId?: number | null; enabled: boolean }) {
  assertDeveloper(user);
  const db = await requireDb();
  if (input.id) {
    await db.update(featureFlags).set({ displayName: input.displayName.trim().slice(0, 160), description: input.description?.trim().slice(0, 2000) ?? null, target: input.target, branchId: input.branchId ?? null, enabled: input.enabled }).where(eq(featureFlags.id, input.id));
  } else {
    await db.insert(featureFlags).values({ featureKey: input.featureKey.trim().slice(0, 120), displayName: input.displayName.trim().slice(0, 160), description: input.description?.trim().slice(0, 2000) ?? null, target: input.target, branchId: input.branchId ?? null, enabled: input.enabled, createdById: user.id });
  }
  return { success: true } as const;
}

export async function updateDeveloperProfile(user: DeveloperActor, input: { username: string; displayName: string }) {
  assertDeveloper(user);
  const db = await requireDb();
  const username = input.username.trim().slice(0, 64);
  const displayName = input.displayName.trim().slice(0, 120);
  if (!username || !displayName) throw new TRPCError({ code: "BAD_REQUEST", message: "اسم المستخدم واسم العرض مطلوبان." });
  const [duplicate] = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.username, username)).limit(1);
  if (duplicate && duplicate.id !== user.id) throw new TRPCError({ code: "CONFLICT", message: "اسم المستخدم مستخدم لحساب آخر." });
  await db.update(staffUsers).set({ username, displayName }).where(eq(staffUsers.id, user.id));
  return { success: true as const, username, displayName };
}

export async function createRelease(user: DeveloperActor, input: { version: string; title: string; notes?: string | null; target: "developer" | "branch" | "all"; targetBranchId?: number | null; artifactName?: string | null; artifactBase64?: string | null }) {
  assertDeveloper(user);
  const db = await requireDb();
  const encoded = input.artifactBase64?.replace(/^data:[^;]+;base64,/, "") ?? "";
  if (encoded && (!encoded.startsWith("UEs") || encoded.length > 14_000_000)) throw new TRPCError({ code: "BAD_REQUEST", message: "الملف يجب أن يكون ZIP صالحًا وألا يتجاوز الحد المسموح." });
  await db.insert(releaseManifests).values({ version: input.version.trim().slice(0, 40), title: input.title.trim().slice(0, 160), notes: input.notes?.trim().slice(0, 5000) ?? null, target: input.target, targetBranchId: input.targetBranchId ?? null, artifactName: input.artifactName?.slice(0, 160) ?? null, artifactData: encoded ? Buffer.from(encoded, "base64") : null, artifactSize: encoded ? Math.floor(encoded.length * 0.75) : null, createdById: user.id, status: "uploaded" });
  return { success: true, status: "uploaded" } as const;
}

export async function updateReleaseStatus(user: DeveloperActor, input: { id: number; status: "uploaded" | "testing" | "approved" | "deployed" | "rolled_back" }) {
  assertDeveloper(user);
  const db = await requireDb();
  await db.update(releaseManifests).set({ status: input.status }).where(eq(releaseManifests.id, input.id));
  return { success: true } as const;
}

export async function inspectRelease(user: DeveloperActor, releaseId: number) {
  assertDeveloper(user);
  const db = await requireDb();
  const [release] = await db.select({ id: releaseManifests.id, artifactData: releaseManifests.artifactData, artifactName: releaseManifests.artifactName, artifactSize: releaseManifests.artifactSize }).from(releaseManifests).where(eq(releaseManifests.id, releaseId)).limit(1);
  if (!release) throw new TRPCError({ code: "NOT_FOUND", message: "الإصدار غير موجود." });
  if (!release.artifactData) throw new TRPCError({ code: "BAD_REQUEST", message: "لا يوجد ملف ZIP لفحصه." });
  if (release.artifactData.length > 14_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "الملف أكبر من حد الفحص." });
  const workDir = await mkdtemp(path.join(tmpdir(), "matbakh-release-"));
  const archivePath = path.join(workDir, "release.zip");
  try {
    await writeFile(archivePath, release.artifactData);
    const checks: Array<{ name: string; status: "passed" | "warning" | "failed"; detail: string }> = [];
    try {
      await execFileAsync("unzip", ["-t", archivePath], { timeout: 45_000, maxBuffer: 2_000_000 });
      checks.push({ name: "سلامة ملف ZIP", status: "passed", detail: "تمت قراءة الأرشيف دون أخطاء." });
    } catch {
      checks.push({ name: "سلامة ملف ZIP", status: "failed", detail: "الملف غير صالح أو تالف." });
      return { releaseId, artifactName: release.artifactName, artifactSize: release.artifactSize, checks, safeToContinue: false, runtimePreview: false };
    }
    const { stdout } = await execFileAsync("unzip", ["-Z1", archivePath], { timeout: 20_000, maxBuffer: 4_000_000 });
    const files = stdout.split("\n").map(item => item.trim()).filter(Boolean);
    const unsafe = files.filter(file => file.startsWith("/") || file.includes("../") || file.includes("\\..\\"));
    checks.push({ name: "مسارات الملفات", status: unsafe.length ? "failed" : "passed", detail: unsafe.length ? `وُجدت ${unsafe.length} مسارات خطرة.` : `تم فحص ${files.length} ملفًا دون مسارات خطرة.` });
    const hasPackage = files.some(file => file === "package.json" || file.endsWith("/package.json"));
    const hasLock = files.some(file => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(file));
    checks.push({ name: "ملفات مشروع Node", status: hasPackage ? "passed" : "warning", detail: hasPackage ? "تم العثور على package.json." : "لم يتم العثور على package.json." });
    checks.push({ name: "ملف تثبيت الاعتمادات", status: hasLock ? "passed" : "warning", detail: hasLock ? "تم العثور على ملف lock." : "لا يوجد ملف lock واضح؛ قد يحتاج التثبيت وقتًا أطول." });
    checks.push({ name: "تشغيل الكود", status: "warning", detail: "لم يتم تشغيل الكود المرفوع داخل الإنتاج. المعاينة التنفيذية المعزولة تحتاج Worker منفصلًا." });
    if (!unsafe.length) await db.update(releaseManifests).set({ status: "testing" }).where(eq(releaseManifests.id, releaseId));
    return { releaseId, artifactName: release.artifactName, artifactSize: release.artifactSize, checks, safeToContinue: !unsafe.length, runtimePreview: false };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
