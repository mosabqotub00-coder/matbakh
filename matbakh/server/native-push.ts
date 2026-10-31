import { TRPCError } from "@trpc/server";
import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { staffSessions } from "../drizzle/schema";
import { nativePushDevices } from "../drizzle/native-push-schema";
import type { Notification } from "../drizzle/notifications-schema";
import { publicProcedure, router, staffProcedure } from "./_core/trpc";
import { getDb } from "./db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const NATIVE_CHANNEL_ID = "matbakh-orders-v1";

const installationId = z.string().regex(/^mbx_[0-9a-f]{40}$/);
const expoPushToken = z.string().max(255).regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_\-]+\]$/);

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "قاعدة البيانات غير متاحة." });
  return db;
}

async function sendExpoMessages(messages: ExpoMessage[]) {
  if (!messages.length) return [] as Array<{ status?: string; details?: { error?: string } }>;
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const tickets: Array<{ status?: string; details?: { error?: string } }> = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map(message => ({
      ...message,
      sound: "default",
      priority: "high",
      channelId: NATIVE_CHANNEL_ID,
      ttl: 3600,
    }));
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as { data?: typeof tickets } | null;
    if (!response.ok || !Array.isArray(body?.data)) {
      console.warn("[NativePush] Expo rejected the batch", response.status);
      tickets.push(...chunk.map(() => ({ status: "error" })));
      continue;
    }
    tickets.push(...body.data);
  }
  return tickets;
}

async function dropUnregisteredTokens(tokens: string[], tickets: Array<{ status?: string; details?: { error?: string } }>) {
  const dead = tokens.filter((_, index) => tickets[index]?.details?.error === "DeviceNotRegistered");
  if (!dead.length) return;
  const db = await requireDb();
  await db.delete(nativePushDevices).where(inArray(nativePushDevices.expoPushToken, dead));
}

/** Devices whose bound staff session is still valid; logout/expiry stops delivery immediately. */
async function liveDevices(userIds: number[]) {
  if (!userIds.length) return [];
  const db = await requireDb();
  return db
    .select({ id: nativePushDevices.id, token: nativePushDevices.expoPushToken })
    .from(nativePushDevices)
    .innerJoin(staffSessions, and(
      eq(staffSessions.tokenHash, nativePushDevices.sessionHash),
      eq(staffSessions.userId, nativePushDevices.userId),
    ))
    .where(and(inArray(nativePushDevices.userId, userIds), gt(staffSessions.expiresAt, new Date())));
}

export async function deliverNativePush(notification: Notification, userIds: number[]) {
  const devices = await liveDevices(userIds);
  const tokens = Array.from(new Set(devices.map(device => device.token)));
  const messages = tokens.map(token => ({
    to: token,
    title: notification.title,
    body: notification.body,
    data: {
      deliveryId: `${notification.id}`,
      notificationId: notification.id,
      branchId: notification.branchId,
      orderId: notification.orderId,
      type: notification.type,
      targetSection: notification.targetSection,
      url: "/notifications",
    },
  }));
  const tickets = await sendExpoMessages(messages);
  await dropUnregisteredTokens(tokens, tickets);
}

async function ownedDevice(userId: number, sessionHash: string | null, id: string) {
  const db = await requireDb();
  const [device] = await db
    .select()
    .from(nativePushDevices)
    .where(eq(nativePushDevices.installationId, id))
    .limit(1);
  if (!device || device.userId !== userId || device.sessionHash !== sessionHash) return null;
  return device;
}

export const nativePushRouter = router({
  status: staffProcedure
    .input(z.object({ installationId }))
    .query(async ({ ctx, input }) => ({
      registered: Boolean(await ownedDevice(ctx.staffUser.id, ctx.staffSessionHash, input.installationId)),
    })),
  register: staffProcedure
    .input(z.object({
      installationId,
      expoPushToken,
      platform: z.literal("android"),
      appVersion: z.string().trim().max(32).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.staffUser.mustChangePassword || !ctx.staffSessionHash)
        throw new TRPCError({ code: "FORBIDDEN", message: "غيّر كلمة المرور المؤقتة أولاً." });
      const db = await requireDb();
      const values = {
        userId: ctx.staffUser.id,
        sessionHash: ctx.staffSessionHash,
        expoPushToken: input.expoPushToken,
        platform: input.platform,
        appVersion: input.appVersion ?? null,
      };
      await db
        .delete(nativePushDevices)
        .where(and(eq(nativePushDevices.expoPushToken, input.expoPushToken), ne(nativePushDevices.installationId, input.installationId)));
      await db
        .insert(nativePushDevices)
        .values({ installationId: input.installationId, ...values })
        .onDuplicateKeyUpdate({ set: { ...values, updatedAt: new Date() } });
      return { registered: true as const };
    }),
  // Public on purpose: logout may already have cleared the cookie; the random installationId is the capability.
  unregister: publicProcedure
    .input(z.object({ installationId }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(nativePushDevices).where(eq(nativePushDevices.installationId, input.installationId));
      return { registered: false as const };
    }),
  acknowledge: staffProcedure
    .input(z.object({
      installationId,
      deliveryId: z.union([z.string().max(64), z.number().int()]),
      state: z.enum(["received", "opened"]),
    }))
    .mutation(async ({ ctx, input }) => ({
      success: Boolean(await ownedDevice(ctx.staffUser.id, ctx.staffSessionHash, input.installationId)),
    })),
  test: staffProcedure
    .input(z.object({ installationId }))
    .mutation(async ({ ctx, input }) => {
      const device = await ownedDevice(ctx.staffUser.id, ctx.staffSessionHash, input.installationId);
      if (!device) throw new TRPCError({ code: "NOT_FOUND", message: "هذا الجهاز غير مسجل للإشعارات." });
      const [ticket] = await sendExpoMessages([{
        to: device.expoPushToken,
        title: "مطبخي — تجربة الإشعارات",
        body: "وصل هذا التنبيه إلى هاتفك بنجاح.",
        data: { deliveryId: `test-${Date.now()}`, type: "test", url: "/notifications" },
      }]);
      await dropUnregisteredTokens([device.expoPushToken], [ticket]);
      return { success: ticket?.status === "ok" };
    }),
});
