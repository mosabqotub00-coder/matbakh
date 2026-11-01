import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import webpush from "web-push";
import {
  kitchenOrderItems,
  kitchenOrders,
  staffUsers,
} from "../drizzle/schema";
import {
  notificationReads,
  notifications,
  pushSubscriptions,
  settings,
  type Notification,
} from "../drizzle/notifications-schema";
import { getDb } from "./db";
import { deliverNativePush } from "./native-push";
import { ticketLabel } from "../shared/ticket-label";

export type NotificationSection = "station" | "kitchen" | "all";
export type NotificationType =
  | "order_created"
  | "near_due"
  | "grace_entered"
  | "late"
  | "extended"
  | "ready"
  | "received"
  | "broadcast_started"
  | (string & {});

export type EmitNotificationInput = {
  branchId: number;
  orderId?: number;
  type: NotificationType;
  title: string;
  body: string;
  targetSection?: NotificationSection;
  dedupeKey?: string;
};

export type StaffAudienceRecord = {
  id: number;
  role?: string | null;
  branchId?: number | null;
  canStation?: boolean | number | null;
  canKitchen?: boolean | number | null;
  canManager?: boolean | number | null;
  isActive?: boolean | number | null;
};

const MONITOR_ROLES = new Set([
  "developer",
  "system_admin",
  "branch_manager",
  "kitchen_manager",
  "shift_manager",
]);
const ROLE_VALUES = new Set([
  "system_admin",
  "branch_manager",
  "kitchen_manager",
  "shift_manager",
  "station",
  "kitchen",
]);
const DEADLINE_NEAR_MS = 2 * 60 * 1000;
const SETTING_VAPID_PUBLIC = "push.vapid.public";
const SETTING_VAPID_PRIVATE = "push.vapid.private";
const SETTING_VAPID_KEYPAIR = "push.vapid.keypair";
const SETTING_VAPID_SUBJECT = "push.vapid.subject";
const SETTING_DEADLINE_TASK_UID = "schedule.deadlines.task_uid";

function asRecord(value: unknown): Record<string, any> {
  return (value && typeof value === "object" ? value : {}) as Record<
    string,
    any
  >;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function asBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

export function staffRole(user: StaffAudienceRecord): string | null {
  const role = typeof user.role === "string" ? user.role : null;
  // Compatibility flags are only a fallback for rows without a role. An
  // invalid role must fail closed rather than inheriting stale capabilities.
  if (role) return ROLE_VALUES.has(role) ? role : null;
  if (asBoolean(user.canManager)) return "branch_manager";
  if (asBoolean(user.canKitchen)) return "kitchen";
  if (asBoolean(user.canStation)) return "station";
  return null;
}

/** Pure audience policy shared by list and push delivery. */
export function canReceiveNotification(
  user: StaffAudienceRecord,
  branchId: number,
  targetSection: NotificationSection = "all",
  targetRole?: string | null
) {
  if (!asBoolean(user.isActive ?? true)) return false;
  const role = staffRole(user);
  if (!role) return false;
  if (targetRole && role !== targetRole) return false;
  const isSystemAdmin = role === "system_admin" || role === "developer";
  if (
    !isSystemAdmin &&
    user.branchId != null &&
    Number(user.branchId) !== branchId
  )
    return false;
  if (!isSystemAdmin && user.branchId == null && branchId !== 0) return false;
  if (targetSection === "all") return true;
  // Monitor roles receive operational notifications for both work sections.
  if (MONITOR_ROLES.has(role)) return true;
  return targetSection === "station" ? role === "station" : role === "kitchen";
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return false;
    const host = url.hostname.toLowerCase();
    const known = [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "notify.windows.com",
    ];
    return known.some(value => host === value || host.endsWith(`.${value}`));
  } catch {
    return false;
  }
}

export function pushEndpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

export function deadlineDedupeKey(
  orderId: number,
  phase: "near_due" | "grace_entered" | "late",
  effectiveDueAt: Date
) {
  return `deadline:${orderId}:${phase}:${effectiveDueAt.toISOString()}`;
}

async function getDatabase() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة");
  return db;
}

async function readSetting(key: string) {
  const db = await getDatabase();
  const [row] = await db
    .select({ value: settings.settingValue })
    .from(settings)
    .where(eq(settings.settingKey, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string) {
  const db = await getDatabase();
  await db
    .insert(settings)
    .values({ settingKey: key, settingValue: value })
    .onDuplicateKeyUpdate({ set: { settingValue: value } });
}

async function ensureVapidKeys() {
  const db = await getDatabase();
  const rows = await db
    .select({ key: settings.settingKey, value: settings.settingValue })
    .from(settings)
    .where(
      inArray(settings.settingKey, [
        SETTING_VAPID_KEYPAIR,
        SETTING_VAPID_SUBJECT,
        SETTING_VAPID_PUBLIC,
        SETTING_VAPID_PRIVATE,
      ])
    );
  const stored = new Map(rows.map(row => [row.key, row.value]));
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    stored.get(SETTING_VAPID_SUBJECT)?.trim() ||
    "";
  if (!isValidVapidSubject(subject)) return null;
  let publicKey: string | undefined;
  let privateKey: string | undefined;
  try {
    const pair = stored.get(SETTING_VAPID_KEYPAIR);
    if (pair) {
      const parsed = JSON.parse(pair) as {
        publicKey?: string;
        privateKey?: string;
      };
      publicKey = parsed.publicKey;
      privateKey = parsed.privateKey;
    }
  } catch {
    publicKey = undefined;
    privateKey = undefined;
  }
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    const candidate = JSON.stringify(generated);
    // A no-op duplicate update prevents a racing worker from replacing the
    // first pair. The reread below is authoritative.
    await db
      .insert(settings)
      .values({ settingKey: SETTING_VAPID_KEYPAIR, settingValue: candidate })
      .onDuplicateKeyUpdate({
        set: { settingValue: sql`${settings.settingValue}` },
      });
    const refreshed = await db
      .select({ key: settings.settingKey, value: settings.settingValue })
      .from(settings)
      .where(eq(settings.settingKey, SETTING_VAPID_KEYPAIR))
      .limit(1);
    const fresh = new Map(refreshed.map(row => [row.key, row.value]));
    const storedPair = fresh.get(SETTING_VAPID_KEYPAIR);
    if (!storedPair) return null;
    const parsed = JSON.parse(storedPair) as {
      publicKey?: string;
      privateKey?: string;
    };
    publicKey = parsed.publicKey;
    privateKey = parsed.privateKey;
  }
  if (typeof publicKey !== "string" || typeof privateKey !== "string")
    return null;
  if (!isVapidKey(publicKey, 43, 43) || !isVapidKey(privateKey, 32, 43))
    return null;
  return { subject, publicKey, privateKey };
}

function isVapidKey(value: string, minLength: number, maxLength: number) {
  return (
    value.length >= minLength &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isValidVapidSubject(subject: string) {
  try {
    const url = new URL(subject);
    return (
      url.protocol === "https:" && !url.username && !url.password && !url.port
    );
  } catch {
    return false;
  }
}

export async function configurePushSettings(input: {
  subject: string;
  deadlineTaskUid?: string;
}) {
  if (!isValidVapidSubject(input.subject))
    throw new Error("يجب أن يكون عنوان VAPID رابط HTTPS حقيقيًا.");
  await writeSetting(SETTING_VAPID_SUBJECT, input.subject);
  if (input.deadlineTaskUid?.trim())
    await writeSetting(SETTING_DEADLINE_TASK_UID, input.deadlineTaskUid.trim());
  return getPushStatus();
}

export async function getPushStatus() {
  try {
    const vapid = await ensureVapidKeys();
    const backgroundScheduleReady = Boolean(await configuredDeadlineTaskUid());
    if (!vapid)
      return {
        status: "blocked_config" as const,
        configured: false,
        backendReady: false,
        backgroundScheduleReady,
        contactSubject: null,
        publicKey: null,
        reason: "VAPID_SUBJECT غير مضبوط على الخادم المنشور.",
      };
    return {
      status: "ready" as const,
      configured: true,
      backendReady: true,
      backgroundScheduleReady,
      contactSubject: vapid.subject,
      publicKey: vapid.publicKey,
      reason: null,
    };
  } catch {
    return {
      status: "blocked_config" as const,
      configured: false,
      backendReady: false,
      backgroundScheduleReady: false,
      contactSubject: null,
      publicKey: null,
      reason: "تعذر قراءة إعداد Push الآمن من قاعدة البيانات.",
    };
  }
}

async function activeUsersForNotification(
  input: Pick<EmitNotificationInput, "branchId" | "targetSection"> & {
    targetRole?: string | null;
  }
) {
  const db = await getDatabase();
  const rows = await db.select().from(staffUsers);
  return (rows as unknown as StaffAudienceRecord[]).filter(row =>
    canReceiveNotification(
      row,
      input.branchId,
      input.targetSection ?? "all",
      input.targetRole
    )
  );
}

async function deliverPush(notification: Notification) {
  const vapid = await ensureVapidKeys();
  if (!vapid) return;
  const users = await activeUsersForNotification(notification);
  if (!users.length) return;
  const db = await getDatabase();
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(
      inArray(
        pushSubscriptions.userId,
        users.map(user => user.id)
      )
    );
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const payload = JSON.stringify({
    notificationId: notification.id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    url: "/notifications",
  });
  await Promise.all(
    subscriptions
      .filter(subscription => isAllowedPushEndpoint(subscription.endpoint))
      .map(async subscription => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload
          );
        } catch (error: any) {
          const statusCode = Number(error?.statusCode ?? error?.status ?? 0);
          if (statusCode === 404 || statusCode === 410) {
            await db
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, subscription.id));
          } else {
            // Do not log endpoint, payload, or recipient identity; subscription providers can contain secrets.
            console.warn("[Push] Delivery failed", statusCode || "unknown");
          }
        }
      })
  );
}

async function insertNotification(input: EmitNotificationInput) {
  const db = await getDatabase();
  const dedupeKey = input.dedupeKey?.trim() || null;
  if (dedupeKey) {
    const [existing] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) return { notification: existing, created: false };
  }
  try {
    const inserted = await db.insert(notifications).values({
      branchId: input.branchId,
      orderId: input.orderId ?? null,
      type: input.type,
      title: input.title.trim().slice(0, 180),
      body: input.body.trim().slice(0, 4000),
      targetSection: input.targetSection ?? "all",
      dedupeKey,
    });
    const id = Number(inserted[0].insertId);
    const [created] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return { notification: created, created: true };
  } catch (error: any) {
    // A concurrent heartbeat can win the unique dedupe insert. Treat that as success.
    if (
      dedupeKey &&
      (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062)
    ) {
      const [existing] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.dedupeKey, dedupeKey))
        .limit(1);
      return { notification: existing, created: false };
    }
    throw error;
  }
}

/**
 * Durable event insertion is intentionally catch-safe: order transitions must
 * not roll back because a notification or provider is unavailable.
 */
export async function emitNotification(
  input: EmitNotificationInput
): Promise<void> {
  try {
    if (!Number.isInteger(input.branchId) || input.branchId <= 0) return;
    if (!input.type || !input.title.trim() || !input.body.trim()) return;
    const result = await insertNotification(input);
    if (result?.notification && result.created) {
      try {
        await deliverPush(result.notification);
      } catch {
        console.warn("[Push] Notification delivery skipped");
      }
      const nativeNotification = result.notification;
      void activeUsersForNotification(nativeNotification)
        .then(users => deliverNativePush(nativeNotification, users.map(user => user.id)))
        .catch(() => console.warn("[NativePush] Notification delivery skipped"));
    }
  } catch (error) {
    console.warn(
      "[Notifications] Event persistence skipped",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

function rowBranchId(row: unknown) {
  const value = asRecord(row).branchId ?? asRecord(row).branch_id;
  return Number(value);
}

function rowDueAt(row: unknown) {
  const record = asRecord(row);
  return asDate(record.effectiveDueAt ?? record.effective_due_at);
}

function rowGraceMinutes(row: unknown, snapshot?: number) {
  const record = asRecord(row);
  const value = Number(
    snapshot ?? record.graceMinutes ?? record.grace_minutes ?? 5
  );
  return Number.isFinite(value) && value >= 0 ? value : 5;
}

export type DeadlinePhase = "near_due" | "grace_entered" | "late";

export function deadlinePhase(
  now: Date,
  dueAt: Date,
  graceMinutes: number
): DeadlinePhase | null {
  // An order is late as soon as its preparation time runs out; grace no longer delays it.
  void graceMinutes;
  const dueMs = dueAt.getTime();
  const nowMs = now.getTime();
  if (nowMs >= dueMs) return "late";
  if (nowMs >= dueMs - DEADLINE_NEAR_MS) return "near_due";
  return null;
}

/** Process all active tickets; unique deadline keys make heartbeat retries safe. */
export async function processDeadlineNotifications(
  options: { now?: Date } = {}
) {
  const db = await getDatabase();
  const now = options.now ?? new Date();
  const [rows, itemRows] = await Promise.all([
    db
      .select()
      .from(kitchenOrders)
      .where(eq(kitchenOrders.status, "preparing")),
    db
      .select({
        orderId: kitchenOrderItems.orderId,
        graceMinutes: kitchenOrderItems.graceMinutes,
        hasTimer: kitchenOrderItems.hasTimer,
      })
      .from(kitchenOrderItems),
  ]);
  const graceByOrder = new Map(
    itemRows.map(item => [item.orderId, item.graceMinutes])
  );
  const timerByOrder = new Map(
    itemRows.map(item => [item.orderId, item.hasTimer !== false])
  );
  let emitted = 0;
  for (const row of rows as unknown as Array<Record<string, any>>) {
    const branchId = rowBranchId(row);
    const orderId = Number(row.id);
    if (timerByOrder.get(orderId) === false) continue;
    const dueAt = rowDueAt(row);
    if (
      !Number.isInteger(branchId) ||
      branchId <= 0 ||
      !Number.isInteger(orderId) ||
      !dueAt
    )
      continue;
    const phase = deadlinePhase(
      now,
      dueAt,
      rowGraceMinutes(row, graceByOrder.get(orderId))
    );
    if (!phase) continue;
    const label = ticketLabel({ id: orderId });
    const copy: Record<DeadlinePhase, { title: string; body: string }> = {
      near_due: {
        title: "اقترب موعد التذكرة",
        body: `${label} تقترب من نهاية التحضير.`,
      },
      grace_entered: {
        title: "بدأ وقت السماح",
        body: `${label} دخلت وقت السماح؛ يرجى متابعة التحضير.`,
      },
      late: {
        title: "تذكرة متأخرة",
        body: `${label} تجاوزت وقت التحضير المحدد.`,
      },
    };
    await emitNotification({
      branchId,
      orderId,
      type: phase,
      title: copy[phase].title,
      body: copy[phase].body,
      targetSection: "kitchen",
      dedupeKey: deadlineDedupeKey(orderId, phase, dueAt),
    });
    emitted += 1;
    if (phase === "late" && !asBoolean(row.everOverdue ?? row.ever_overdue)) {
      const everOverdueColumn = (kitchenOrders as any).everOverdue;
      const idColumn = (kitchenOrders as any).id;
      if (everOverdueColumn && idColumn) {
        await db
          .update(kitchenOrders)
          .set({ everOverdue: true } as any)
          .where(eq(idColumn, orderId));
      }
    }
  }
  return { emitted };
}

function notificationVisibleToUser(
  notification: Notification,
  user: StaffAudienceRecord,
  branchId?: number
) {
  const selectedBranch = branchId ?? notification.branchId;
  if (
    branchId != null &&
    notification.branchId !== branchId &&
    !["system_admin", "developer"].includes(staffRole(user) ?? "")
  )
    return false;
  return (
    canReceiveNotification(
      user,
      notification.branchId,
      notification.targetSection as NotificationSection,
      notification.targetRole
    ) &&
    (branchId == null ||
      notification.branchId === selectedBranch ||
      ["system_admin", "developer"].includes(staffRole(user) ?? ""))
  );
}

export async function listNotificationsForUser(
  user: StaffAudienceRecord,
  input: { branchId?: number } = {}
) {
  const db = await getDatabase();
  const role = staffRole(user);
  const branchFilter =
    input.branchId ??
    (["system_admin", "developer"].includes(role ?? "") ? undefined : (user.branchId ?? undefined));
  const rows = await db
    .select()
    .from(notifications)
    .where(
      branchFilter == null
        ? undefined
        : eq(notifications.branchId, branchFilter)
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(200);
  const visible = (rows as Notification[]).filter(row =>
    notificationVisibleToUser(row, user, input.branchId)
  );
  if (!visible.length) return [];
  const reads = await db
    .select()
    .from(notificationReads)
    .where(
      and(
        eq(notificationReads.userId, user.id),
        inArray(
          notificationReads.notificationId,
          visible.map(row => row.id)
        )
      )
    );
  const readIds = new Set(reads.map(row => row.notificationId));
  return visible.map(row => ({ ...row, read: readIds.has(row.id) }));
}

async function assertNotificationVisible(
  user: StaffAudienceRecord,
  id: number
) {
  const db = await getDatabase();
  const [row] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);
  if (!row || !notificationVisibleToUser(row, user))
    throw new Error("الإشعار غير متاح");
  return row;
}

export async function markNotificationRead(
  user: StaffAudienceRecord,
  id: number
) {
  const db = await getDatabase();
  await assertNotificationVisible(user, id);
  const [existing] = await db
    .select({ id: notificationReads.id })
    .from(notificationReads)
    .where(
      and(
        eq(notificationReads.notificationId, id),
        eq(notificationReads.userId, user.id)
      )
    )
    .limit(1);
  if (!existing)
    await db
      .insert(notificationReads)
      .values({ notificationId: id, userId: user.id });
  return { success: true as const };
}

export async function markAllNotificationsRead(
  user: StaffAudienceRecord,
  branchId?: number
) {
  const db = await getDatabase();
  const visible = await listNotificationsForUser(user, { branchId });
  for (const notification of visible) {
    if (!notification.read) {
      await db
        .insert(notificationReads)
        .values({ notificationId: notification.id, userId: user.id })
        .onDuplicateKeyUpdate({ set: { readAt: new Date() } });
    }
  }
  return {
    success: true as const,
    count: visible.filter(row => !row.read).length,
  };
}

export async function savePushSubscription(
  userId: number,
  input: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  if (!isAllowedPushEndpoint(input.endpoint))
    throw new Error("عنوان Push غير مسموح.");
  if (
    !input.keys?.p256dh ||
    !input.keys.auth ||
    input.keys.p256dh.length > 255 ||
    input.keys.auth.length > 255
  ) {
    throw new Error("مفاتيح Push غير صالحة.");
  }
  const db = await getDatabase();
  const endpointHash = createHash("sha256")
    .update(input.endpoint)
    .digest("hex");
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      endpointHash,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onDuplicateKeyUpdate({
      set: {
        userId,
        endpoint: input.endpoint,
        endpointHash,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        updatedAt: new Date(),
      },
    });
  return { success: true as const };
}

export async function removePushSubscription(userId: number, endpoint: string) {
  if (!isAllowedPushEndpoint(endpoint))
    throw new Error("عنوان Push غير مسموح.");
  const db = await getDatabase();
  const endpointHash = createHash("sha256").update(endpoint).digest("hex");
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpointHash, endpointHash)
      )
    );
  return { success: true as const };
}

export async function configuredDeadlineTaskUid() {
  return (
    process.env.DEADLINE_SCHEDULE_TASK_UID?.trim() ||
    (await readSetting(SETTING_DEADLINE_TASK_UID))
  );
}
