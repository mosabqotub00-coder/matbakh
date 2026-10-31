import type { Express, Request, Response } from "express";
import { jwtVerify } from "jose";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";
import { router, staffProcedure } from "./_core/trpc";
import {
  configuredDeadlineTaskUid,
  configurePushSettings,
  getPushStatus,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  removePushSubscription,
  savePushSubscription,
  processDeadlineNotifications,
  type StaffAudienceRecord,
} from "./notifications";

const endpointInput = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(16).max(255),
    auth: z.string().min(8).max(255),
  }),
});

function audienceUser(value: unknown): StaffAudienceRecord {
  const user = value as StaffAudienceRecord;
  return { ...user, isActive: user.isActive ?? true };
}

const notificationProcedure = staffProcedure.use(({ ctx, next }) => {
  if (ctx.staffUser.mustChangePassword)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "غيّر كلمة المرور المؤقتة أولًا.",
    });
  return next({ ctx });
});

export const notificationsRouter = router({
  list: notificationProcedure
    .input(
      z.object({ branchId: z.number().int().positive().optional() }).optional()
    )
    .query(({ ctx, input }) =>
      listNotificationsForUser(audienceUser(ctx.staffUser), input ?? {})
    ),
  markRead: notificationProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ ctx, input }) =>
      markNotificationRead(audienceUser(ctx.staffUser), input.id)
    ),
  markAllRead: notificationProcedure
    .input(
      z.object({ branchId: z.number().int().positive().optional() }).optional()
    )
    .mutation(({ ctx, input }) =>
      markAllNotificationsRead(audienceUser(ctx.staffUser), input?.branchId)
    ),
  status: notificationProcedure.query(() => getPushStatus()),
  subscribe: notificationProcedure
    .input(endpointInput)
    .mutation(({ ctx, input }) =>
      savePushSubscription(ctx.staffUser!.id, input)
    ),
  unsubscribe: notificationProcedure
    .input(z.object({ endpoint: z.string().url().max(2048) }))
    .mutation(({ ctx, input }) =>
      removePushSubscription(ctx.staffUser!.id, input.endpoint)
    ),
  configure: notificationProcedure
    .input(
      z.object({
        subject: z
          .string()
          .url()
          .refine(
            value => value.startsWith("https://"),
            "يجب استخدام رابط HTTPS حقيقي."
          ),
        deadlineTaskUid: z.string().trim().min(1).max(200).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      if (ctx.staffUser?.role !== "system_admin" && ctx.staffUser?.role !== "developer")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "إعداد Push متاح لمدير النظام الأعلى فقط.",
        });
      return configurePushSettings(input);
    }),
});

function cookieValue(req: Request, name: string) {
  const prefix = `${name}=`;
  return (req.headers.cookie ?? "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(prefix))
    ?.slice(prefix.length);
}

async function verifyPlatformSchedule(req: Request) {
  const token = cookieValue(req, "app_session_id");
  if (!token || !ENV.cookieSecret || !ENV.appId || !ENV.oAuthServerUrl)
    return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(ENV.cookieSecret),
      { algorithms: ["HS256"] }
    );
    if (
      payload.appId !== ENV.appId ||
      typeof payload.openId !== "string" ||
      !payload.openId.startsWith("cron_")
    )
      return null;
    const response = await fetch(
      `${ENV.oAuthServerUrl.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jwt_token: token, project_id: ENV.appId }),
      }
    );
    if (!response.ok) return null;
    const identity = (await response.json()) as {
      openId?: string;
      projectId?: string;
      taskUid?: string;
    };
    if (identity.projectId && identity.projectId !== ENV.appId) return null;
    if (identity.openId && identity.openId !== payload.openId) return null;
    if (!identity.taskUid) return null;
    const configuredTaskUid = await configuredDeadlineTaskUid();
    if (!configuredTaskUid || configuredTaskUid !== identity.taskUid)
      return null;
    return identity;
  } catch {
    return null;
  }
}

/** Parent registers this function from the server entrypoint after body parsing. */
export function registerNotificationRoutes(app: Express) {
  app.post("/api/scheduled/deadlines", async (req: Request, res: Response) => {
    const identity = await verifyPlatformSchedule(req);
    if (!identity) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const result = await processDeadlineNotifications();
      res.status(200).json({ ok: true, taskUid: identity.taskUid, ...result });
    } catch {
      res.status(503).json({ error: "deadline_processing_unavailable" });
    }
  });
}

export { verifyPlatformSchedule };
