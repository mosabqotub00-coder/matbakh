import { and, desc, eq, gt, lt, ne } from "drizzle-orm";
import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import { staffSessions, staffUsers, type StaffUser } from "../drizzle/schema";
import {
  canManageStaff,
  isSystemAdmin,
  roleCapabilities,
  roleOf,
  type StaffLike,
  type StaffRole,
} from "../shared/roles";
import { getBranch, resolveBranchId, type BranchActor } from "./branches";
import { getDb } from "./db";

export const STAFF_SESSION_COOKIE = "matbakh_staff_session";
export const STAFF_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StaffSessionUser = Pick<
  StaffUser,
  | "id"
  | "username"
  | "displayName"
  | "usualShift"
  | "role"
  | "branchId"
  | "canStation"
  | "canKitchen"
  | "canManager"
  | "canManageUsers"
  | "canBroadcast"
  | "canExtend"
  | "isActive"
  | "mustChangePassword"
  | "createdAt"
> & { name: string; email: string | null };

export type CreateStaffInput = {
  username: string;
  displayName: string;
  password: string;
  role?: StaffRole;
  branchId?: number | null;
  usualShift?: "morning" | "evening" | "flexible" | null;
  canStation?: boolean;
  canKitchen?: boolean;
  canManager?: boolean;
};

export type UpdateStaffInput = {
  id: number;
  username?: string;
  displayName?: string;
  password?: string;
  role?: StaffRole;
  branchId?: number | null;
  usualShift?: "morning" | "evening" | "flexible" | null;
  canStation?: boolean;
  canKitchen?: boolean;
  canManager?: boolean;
  isActive?: boolean;
};

const loginFailures = new Map<
  string,
  { count: number; windowStartedAt: number; blockedUntil: number }
>();
const DUMMY_PASSWORD_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;
const MAX_LOGIN_FAILURES = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BLOCK_MS = 60 * 1000;
const MAX_STORED_LOGIN_KEYS = 10_000;

function normalizeUsername(username: string) {
  return username.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function normalizeEmail(email: string) {
  return email.normalize("NFKC").trim().toLowerCase();
}

function flagsForRole(role: StaffRole) {
  const capabilities = roleCapabilities(role);
  return {
    canStation: capabilities.station,
    canKitchen: capabilities.kitchen,
    canManager: capabilities.manager,
    canManageUsers: capabilities.manageUsers,
    canBroadcast: capabilities.broadcast,
    canExtend: capabilities.extend,
  };
}

function roleFromInput(
  input: Pick<
    CreateStaffInput,
    "role" | "canStation" | "canKitchen" | "canManager"
  >,
  fallback: StaffRole = "station"
): StaffRole {
  if (input.role) return input.role;
  if (input.canManager) return "shift_manager";
  if (input.canStation && input.canKitchen) return "kitchen_manager";
  if (input.canStation) return "station";
  if (input.canKitchen) return "kitchen";
  return fallback;
}

function safeUser(
  user: Pick<
    StaffUser,
    | "id"
    | "username"
    | "displayName"
    | "usualShift"
    | "role"
    | "branchId"
    | "canStation"
    | "canKitchen"
    | "canManager"
    | "canManageUsers"
    | "canBroadcast"
    | "canExtend"
    | "isActive"
    | "mustChangePassword"
    | "createdAt"
  > & { email?: string | null }
): StaffSessionUser {
  const role = roleOf(user) ?? "station";
  const capabilities = flagsForRole(role);
  const explicitRole = Boolean(user.role);
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    usualShift: user.usualShift ?? null,
    name: user.displayName,
    email: user.email ?? null,
    role,
    branchId: user.branchId ?? null,
    canStation: explicitRole
      ? capabilities.canStation
      : user.canStation || capabilities.canStation,
    canKitchen: explicitRole
      ? capabilities.canKitchen
      : user.canKitchen || capabilities.canKitchen,
    canManager: explicitRole
      ? capabilities.canManager
      : user.canManager || capabilities.canManager,
    canManageUsers: explicitRole
      ? capabilities.canManageUsers
      : user.canManageUsers || capabilities.canManageUsers,
    canBroadcast: explicitRole
      ? capabilities.canBroadcast
      : user.canBroadcast || capabilities.canBroadcast,
    canExtend: explicitRole
      ? capabilities.canExtend
      : user.canExtend || capabilities.canExtend,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}

function deriveKey(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, 64, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

export async function hashStaffPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyStaffPassword(password: string, encoded: string) {
  const [scheme, saltHex, digestHex] = encoded.split("$");
  if (scheme !== "scrypt" || !saltHex || !digestHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(digestHex, "hex");
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function enforceLoginLimit(key: string) {
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry) return;
  if (entry.blockedUntil > now)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "محاولات دخول كثيرة. انتظر دقيقة ثم أعد المحاولة.",
    });
  if (now - entry.windowStartedAt > LOGIN_WINDOW_MS) loginFailures.delete(key);
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  let entry = loginFailures.get(key);
  if (!entry || now - entry.windowStartedAt > LOGIN_WINDOW_MS)
    entry = { count: 0, windowStartedAt: now, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_LOGIN_FAILURES)
    entry.blockedUntil = now + LOGIN_BLOCK_MS;
  loginFailures.set(key, entry);
  if (loginFailures.size > MAX_STORED_LOGIN_KEYS) {
    for (const [storedKey, value] of loginFailures) {
      if (
        now - value.windowStartedAt > LOGIN_WINDOW_MS &&
        value.blockedUntil < now
      )
        loginFailures.delete(storedKey);
    }
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "قاعدة البيانات غير متاحة.",
    });
  return db;
}

function assertStaffManager(actor?: BranchActor | null) {
  if (actor && !canManageStaff(actor))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لا تملك صلاحية إدارة الحسابات.",
    });
}

function isPrivilegedRole(role: StaffRole | null | undefined) {
  return role === "developer" || role === "system_admin" || role === "branch_manager";
}

function isGlobalRole(role: StaffRole | null | undefined) {
  return role === "developer" || role === "system_admin";
}

function legacyManagerAccount(account: Pick<StaffUser, "role" | "canManager">) {
  return (
    account.role === "developer" || account.role === "system_admin" || (!account.role && account.canManager)
  );
}

function assertTargetScope(
  actor: BranchActor | null | undefined,
  target: Pick<StaffUser, "role" | "branchId">,
  requestedBranchId?: number | null,
  requestedRole?: StaffRole
) {
  if (!actor) return;
  if (isSystemAdmin(actor)) return;
  if (roleOf(actor) !== "branch_manager")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لا تملك صلاحية إدارة الحسابات.",
    });
  if (
    target.branchId !== actor.branchId ||
    isPrivilegedRole(target.role) ||
    isPrivilegedRole(requestedRole)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "مدير الفرع لا يستطيع إدارة حسابات الإدارة العليا أو فرع آخر.",
    });
  }
  if (requestedBranchId !== undefined && requestedBranchId !== actor.branchId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لا يمكنك نقل حساب إلى فرع آخر.",
    });
  }
}

export async function getStaffSessionContext(
  token: string
): Promise<{ user: StaffSessionUser; tokenHash: string } | null> {
  if (!token || token.length > 256) return null;
  const db = await getDb();
  if (!db) return null;
  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({
      id: staffUsers.id,
      username: staffUsers.username,
      displayName: staffUsers.displayName,
      usualShift: staffUsers.usualShift,
      role: staffUsers.role,
      branchId: staffUsers.branchId,
      canStation: staffUsers.canStation,
      canKitchen: staffUsers.canKitchen,
      canManager: staffUsers.canManager,
      canManageUsers: staffUsers.canManageUsers,
      canBroadcast: staffUsers.canBroadcast,
      canExtend: staffUsers.canExtend,
      isActive: staffUsers.isActive,
      mustChangePassword: staffUsers.mustChangePassword,
      email: staffUsers.email,
      createdAt: staffUsers.createdAt,
    })
    .from(staffSessions)
    .innerJoin(staffUsers, eq(staffSessions.userId, staffUsers.id))
    .where(
      and(
        eq(staffSessions.tokenHash, tokenHash),
        gt(staffSessions.expiresAt, new Date()),
        eq(staffUsers.isActive, true),
        eq(staffUsers.approvalStatus, "approved")
      )
    )
    .limit(1);
  return row ? { user: safeUser(row), tokenHash } : null;
}

export async function authenticateStaff(
  username: string,
  password: string,
  remoteAddress: string
) {
  const normalized = normalizeUsername(username);
  const byEmail = normalized.includes("@");
  const key = `${remoteAddress}:${normalized}`;
  enforceLoginLimit(key);
  const db = await requireDb();
  const [user] = await db
    .select()
    .from(staffUsers)
    .where(byEmail ? eq(staffUsers.email, normalizeEmail(normalized)) : eq(staffUsers.username, normalized))
    .limit(1);
  const passwordMatches = await verifyStaffPassword(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH
  );
  if (user && passwordMatches && user.approvalStatus === "pending") {
    loginFailures.delete(key);
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "حسابك قيد المراجعة. سيتمكن من الدخول بعد موافقة الإدارة.",
    });
  }
  if (!user || !user.isActive || !passwordMatches) {
    recordLoginFailure(key);
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    });
  }
  loginFailures.delete(key);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  await db.delete(staffSessions).where(lt(staffSessions.expiresAt, now));
  await db
    .insert(staffSessions)
    .values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + STAFF_SESSION_TTL_MS),
    });
  return { token, user: safeUser(user) };
}

export async function revokeStaffSession(token?: string) {
  if (!token) return;
  const db = await requireDb();
  await db
    .delete(staffSessions)
    .where(eq(staffSessions.tokenHash, hashSessionToken(token)));
}

export async function changeOwnStaffPassword(
  userId: number,
  currentSessionHash: string | null,
  currentPassword: string,
  newPassword: string
) {
  const db = await requireDb();
  const [user] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.id, userId))
    .limit(1);
  if (
    !user ||
    !user.isActive ||
    !(await verifyStaffPassword(currentPassword, user.passwordHash))
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "كلمة المرور الحالية غير صحيحة.",
    });
  const passwordHash = await hashStaffPassword(newPassword);
  await db
    .update(staffUsers)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(staffUsers.id, userId));
  if (currentSessionHash)
    await db
      .delete(staffSessions)
      .where(
        and(
          eq(staffSessions.userId, userId),
          ne(staffSessions.tokenHash, currentSessionHash)
        )
      );
  else await db.delete(staffSessions).where(eq(staffSessions.userId, userId));
  const [updated] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.id, userId))
    .limit(1);
  if (!updated)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "تعذر تحديث الحساب.",
    });
  return safeUser(updated);
}

export type StaffListScope = "all" | "system" | "branch_managers" | "branch";

export function filterStaffAccounts<
  T extends Pick<StaffUser, "role" | "branchId">,
>(
  rows: T[],
  actor?: BranchActor | null,
  requestedBranchId?: number | null,
  scope: StaffListScope = "all"
) {
  assertStaffManager(actor);
  if (
    (scope === "system" || scope === "branch_managers") &&
    !isSystemAdmin(actor)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "حسابات الإدارة العامة ومديري الفروع متاحة لمدير النظام الأعلى فقط.",
    });
  }
  if (scope === "system") {
    if (requestedBranchId != null)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "حسابات الإدارة العامة مستقلة عن الفروع.",
      });
    return rows.filter(row => row.role === "system_admin" || row.role === "developer");
  }
  const branchId = actor
    ? isSystemAdmin(actor)
      ? scope === "branch"
        ? resolveBranchId(actor, requestedBranchId)
        : (requestedBranchId ?? null)
      : resolveBranchId(actor, requestedBranchId)
    : (requestedBranchId ?? null);
  return rows.filter(
    row =>
      (branchId == null || row.branchId === branchId) &&
      (scope !== "branch_managers" || row.role === "branch_manager") &&
      (scope !== "branch" || (row.role !== "system_admin" && row.role !== "developer")) &&
      (!actor || isSystemAdmin(actor) || !isPrivilegedRole(row.role))
  );
}

export async function listStaffAccounts(
  actor?: BranchActor | null,
  requestedBranchId?: number | null,
  scope: StaffListScope = "all"
) {
  // Check scope even when no data is available, before issuing the query.
  filterStaffAccounts([], actor, requestedBranchId, scope);
  const db = await requireDb();
  const rows = await db
    .select({
      id: staffUsers.id,
      username: staffUsers.username,
      displayName: staffUsers.displayName,
      usualShift: staffUsers.usualShift,
      role: staffUsers.role,
      branchId: staffUsers.branchId,
      canStation: staffUsers.canStation,
      canKitchen: staffUsers.canKitchen,
      canManager: staffUsers.canManager,
      canManageUsers: staffUsers.canManageUsers,
      canBroadcast: staffUsers.canBroadcast,
      canExtend: staffUsers.canExtend,
      isActive: staffUsers.isActive,
      mustChangePassword: staffUsers.mustChangePassword,
      email: staffUsers.email,
      createdAt: staffUsers.createdAt,
    })
    .from(staffUsers)
    .where(eq(staffUsers.approvalStatus, "approved"))
    .orderBy(desc(staffUsers.createdAt), desc(staffUsers.id));
  const visible = filterStaffAccounts(rows, actor, requestedBranchId, scope);
  return {
    users: visible.map(safeUser),
    total: visible.length,
    activeCount: visible.filter(row => row.isActive).length,
  };
}

export async function createStaffAccount(
  actorOrInput: BranchActor | CreateStaffInput,
  maybeInput?: CreateStaffInput
) {
  const actor = maybeInput ? (actorOrInput as BranchActor) : null;
  const input = maybeInput ?? (actorOrInput as CreateStaffInput);
  assertStaffManager(actor);
  const role = roleFromInput(input);
  if (
    actor &&
    !isSystemAdmin(actor) &&
    (isPrivilegedRole(role) || input.branchId !== actor.branchId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "لا يمكنك إنشاء هذا الدور أو الحساب خارج فرعك.",
    });
  if (!isGlobalRole(role) && input.branchId == null)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "يجب ربط الحساب بفرع.",
    });
  // A paused branch may have accounts; only a missing branch is invalid.
  if (!isGlobalRole(role)) await getBranch(input.branchId!);
  const db = await requireDb();
  const username = normalizeUsername(input.username);
  const [existing] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.username, username))
    .limit(1);
  if (existing)
    throw new TRPCError({
      code: "CONFLICT",
      message: "اسم المستخدم مستخدم بالفعل.",
    });
  const passwordHash = await hashStaffPassword(input.password);
  await db
    .insert(staffUsers)
    .values({
      username,
      displayName: input.displayName.trim(),
      passwordHash,
      role,
      usualShift: input.usualShift ?? null,
      branchId: isGlobalRole(role) ? null : (input.branchId ?? null),
      ...flagsForRole(role),
      isActive: true,
      mustChangePassword: true,
    });
  const [created] = await db
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.username, username))
    .limit(1);
  if (!created)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "تعذر إنشاء الحساب.",
    });
  return safeUser(created);
}

export async function updateStaffAccount(
  actorOrInput: BranchActor | UpdateStaffInput,
  maybeInput?: UpdateStaffInput
) {
  const actor = maybeInput ? (actorOrInput as BranchActor) : null;
  const input = maybeInput ?? (actorOrInput as UpdateStaffInput);
  assertStaffManager(actor);
  const db = await requireDb();
  const passwordHash = input.password
    ? await hashStaffPassword(input.password)
    : undefined;
  return db.transaction(async tx => {
    const accounts = await tx
      .select()
      .from(staffUsers)
      .orderBy(staffUsers.id)
      .for("update");
    const current = accounts.find(
      account => account.id === input.id && account.approvalStatus !== "pending"
    );
    if (!current)
      throw new TRPCError({ code: "NOT_FOUND", message: "الحساب غير موجود." });
    assertTargetScope(actor, current, input.branchId, input.role);
    const currentRole = roleOf(current) ?? "station";
    const role =
      input.role ??
      (input.canStation !== undefined ||
      input.canKitchen !== undefined ||
      input.canManager !== undefined
        ? roleFromInput(
            {
              canStation: input.canStation ?? current.canStation,
              canKitchen: input.canKitchen ?? current.canKitchen,
              canManager: input.canManager ?? current.canManager,
            },
            currentRole
          )
        : currentRole);
    if (
      actor &&
      !isSystemAdmin(actor) &&
      (isPrivilegedRole(role) ||
        (input.branchId !== undefined && input.branchId !== actor.branchId))
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "لا يمكنك تعديل هذا الدور أو الفرع.",
      });
    }
    const username =
      input.username === undefined
        ? current.username
        : normalizeUsername(input.username);
    const displayName = input.displayName?.trim() ?? current.displayName;
    const usualShift =
      input.usualShift === undefined ? current.usualShift : input.usualShift;
    const isActive = input.isActive ?? current.isActive;
    const branchId = isGlobalRole(role)
      ? null
      : input.branchId === undefined
        ? current.branchId
        : input.branchId;
    if (!isGlobalRole(role) && branchId == null)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "يجب ربط الحساب بفرع.",
      });
    if (
      accounts.some(
        account => account.id !== input.id && account.username === username
      )
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "اسم المستخدم مستخدم بالفعل.",
      });
    const activeSystemAdmins = accounts.filter(
      account =>
        account.id !== input.id &&
        account.isActive &&
        legacyManagerAccount(account)
    );
    if (
      legacyManagerAccount(current) &&
      current.isActive &&
      (!isActive || !isSystemAdmin({ role })) &&
      activeSystemAdmins.length === 0
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "لا يمكن إيقاف أو إزالة آخر مدير نظام فعّال.",
      });
    }
    if (!isGlobalRole(role)) await getBranch(branchId!);
    const update: Partial<typeof staffUsers.$inferInsert> = {
      username,
      displayName,
      usualShift,
      role,
      branchId,
      ...flagsForRole(role),
      isActive,
    };
    if (passwordHash) {
      update.passwordHash = passwordHash;
      update.mustChangePassword = true;
    }
    await tx.update(staffUsers).set(update).where(eq(staffUsers.id, input.id));
    if (!isActive || input.password)
      await tx.delete(staffSessions).where(eq(staffSessions.userId, input.id));
    return safeUser({ ...current, ...update });
  });
}

export async function bootstrapFirstManager() {
  const db = await requireDb();
  const existing = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .limit(1);
  if (existing.length)
    throw new Error(
      "Staff accounts already exist; refusing to issue or reset a manager password."
    );
  const username = "manager";
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hashStaffPassword(password);
  await db
    .insert(staffUsers)
    .values({
      username,
      displayName: "مدير النظام",
      passwordHash,
      role: "system_admin",
      branchId: null,
      ...flagsForRole("system_admin"),
      isActive: true,
      mustChangePassword: true,
    });
  return { username, temporaryPassword: password };
}

export async function setOwnStaffEmail(
  userId: number,
  currentPassword: string,
  email: string | null
) {
  const limitKey = `set-email:${userId}`;
  enforceLoginLimit(limitKey);
  const db = await requireDb();
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.id, userId)).limit(1);
  if (!user || !user.isActive || !(await verifyStaffPassword(currentPassword, user.passwordHash))) {
    recordLoginFailure(limitKey);
    throw new TRPCError({ code: "UNAUTHORIZED", message: "كلمة المرور الحالية غير صحيحة." });
  }
  loginFailures.delete(limitKey);
  const normalized = email ? normalizeEmail(email) : null;
  if (normalized) {
    const [taken] = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(eq(staffUsers.email, normalized), ne(staffUsers.id, userId)))
      .limit(1);
    if (taken)
      throw new TRPCError({ code: "CONFLICT", message: "هذا البريد مرتبط بحساب آخر." });
  }
  await db.update(staffUsers).set({ email: normalized }).where(eq(staffUsers.id, userId));
  return safeUser({ ...user, email: normalized });
}
