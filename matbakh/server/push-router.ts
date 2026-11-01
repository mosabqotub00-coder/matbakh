import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, staffProcedure } from "./_core/trpc";
import {
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
