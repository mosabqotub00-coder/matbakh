import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  branchManagerProcedure,
  extendProcedure,
  kitchenProcedure,
  managerProcedure,
  monitorProcedure,
  orderEntryProcedure,
  orderReadProcedure,
  publicProcedure,
  receiveProcedure,
  router,
  staffManagementProcedure,
  staffProcedure,
  stationProcedure,
  systemAdminProcedure,
  developerProcedure,
} from "./_core/trpc";
import {
  changeOwnStaffPassword,
  createStaffAccount,
  listStaffAccounts,
  authenticateStaff,
  revokeStaffSession,
  setOwnStaffEmail,
  STAFF_SESSION_COOKIE,
  STAFF_SESSION_TTL_MS,
  updateStaffAccount,
} from "./staff";
import {
  createOrder,
  createProduct,
  extendOrder,
  getOrderVoiceNote,
  listHistory,
  listKitchenOrders,
  listProducts,
  listStationOrders,
  receiveOrder,
  transitionOrder,
  updateProduct,
} from "./kitchen";
import { createBranch, listBranches, updateBranch } from "./branches";
import { communicationsRouter } from "./communications";
import { notificationsRouter } from "./push-router";
import { nativePushRouter } from "./native-push";
import { integrationRouter } from "./integration";
import { operationsAnalytics } from "./reports";
import { createFeedback, createRelease, developerDashboard, developerOperationsReport, getFeedbackAttachment, inspectRelease, reportDeveloperError, runDeveloperSystemCheck, updateDeveloperIssue, updateDeveloperProfile, updateReleaseStatus, upsertFeatureFlag } from "./developer";

const branchIdInput = z.number().int().positive().optional();
const productInput = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  prepMinutes: z.number().int().min(0).max(240),
  graceMinutes: z.number().int().min(0).max(240).default(5),
  hasTimer: z.boolean().default(true),
  branchId: branchIdInput,
}).refine(value => value.hasTimer || value.prepMinutes === 0, {
  message: "الصنف الذي بلا مؤقت يجب أن تكون مدة تحضيره صفرًا.",
  path: ["prepMinutes"],
});
const usernameInput = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(
    /^[\p{L}\p{N}._-]+$/u,
    "استخدم حروفًا أو أرقامًا أو النقطة والشرطة السفلية فقط."
  );
const newPasswordInput = z
  .string()
  .min(10, "كلمة المرور يجب أن تحتوي على 10 أحرف على الأقل.")
  .max(128);
const emailInput = z
  .string()
  .trim()
  .max(320)
  .email("أدخل بريدًا إلكترونيًا صحيحًا.");
const roleInput = z.enum([
  "developer",
  "system_admin",
  "branch_manager",
  "kitchen_manager",
  "shift_manager",
  "station",
  "kitchen",
]);
const usualShiftInput = z.enum(["morning", "evening", "flexible"]);
const roleStaffInput = z.object({
  role: roleInput,
  branchId: z.number().int().positive().nullable().optional(),
});

function readStaffToken(cookieHeader?: string) {
  const prefix = `${STAFF_SESSION_COOKIE}=`;
  const pair = (cookieHeader ?? "")
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));
  return pair?.slice(prefix.length);
}

export const appRouter = router({
  reports: router({
    analytics: systemAdminProcedure
      .input(
        z.object({
          from: z.string().datetime(),
          to: z.string().datetime(),
          branchId: z.number().int().positive().nullable().optional(),
          shift: z.enum(["morning", "evening"]).nullable().optional(),
          tzOffsetMinutes: z.number().int().min(-840).max(840),
        })
      )
      .query(({ input }) =>
        operationsAnalytics({ ...input, from: new Date(input.from), to: new Date(input.to) })
      ),
  }),
  developer: router({
    dashboard: developerProcedure.query(({ ctx }) => developerDashboard(ctx.staffUser)),
    operationsReport: developerProcedure.input(z.object({ period: z.enum(["today", "7days", "30days"]).default("today") }).optional()).query(({ ctx, input }) => developerOperationsReport(ctx.staffUser, input?.period ?? "today")),
    systemCheck: developerProcedure.mutation(({ ctx }) => runDeveloperSystemCheck(ctx.staffUser)),
    reportError: staffProcedure.input(z.object({
      branchId: z.number().int().positive().nullable().optional(),
      userId: z.number().int().positive().nullable().optional(),
      severity: z.enum(["info", "warning", "error", "critical"]).optional(),
      source: z.string().trim().min(1).max(80),
      message: z.string().trim().min(1).max(5000),
      route: z.string().max(255).nullable().optional(),
      details: z.string().max(10000).nullable().optional(),
    })).mutation(({ ctx, input }) => reportDeveloperError({ ...input, userId: input.userId ?? ctx.staffUser.id })),
    feedbackCreate: staffProcedure.input(z.object({
      title: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(10000),
      branchId: z.number().int().positive().nullable().optional(),
      orderId: z.number().int().positive().nullable().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      attachmentBase64: z.string().nullable().optional(),
      attachmentName: z.string().max(160).nullable().optional(),
      attachmentType: z.string().max(120).nullable().optional(),
    })).mutation(({ ctx, input }) => createFeedback(ctx.staffUser, input)),
    issueUpdate: developerProcedure.input(z.object({ kind: z.enum(["error", "feedback"]), id: z.number().int().positive(), status: z.enum(["new", "investigating", "resolved", "ignored", "closed"]) })).mutation(({ ctx, input }) => updateDeveloperIssue(ctx.staffUser, input)),
    feedbackAttachment: developerProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => getFeedbackAttachment(ctx.staffUser, input.id)),
    profileUpdate: developerProcedure.input(z.object({ username: z.string().trim().min(1).max(64), displayName: z.string().trim().min(1).max(120) })).mutation(({ ctx, input }) => updateDeveloperProfile(ctx.staffUser, input)),
    featureUpsert: developerProcedure.input(z.object({ id: z.number().int().positive().optional(), featureKey: z.string().trim().min(1).max(120), displayName: z.string().trim().min(1).max(160), description: z.string().max(2000).nullable().optional(), target: z.enum(["developer", "branch", "all"]), branchId: z.number().int().positive().nullable().optional(), enabled: z.boolean() })).mutation(({ ctx, input }) => upsertFeatureFlag(ctx.staffUser, input)),
    releaseCreate: developerProcedure.input(z.object({ version: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(160), notes: z.string().max(5000).nullable().optional(), target: z.enum(["developer", "branch", "all"]), targetBranchId: z.number().int().positive().nullable().optional(), artifactName: z.string().max(160).nullable().optional(), artifactBase64: z.string().nullable().optional() })).mutation(({ ctx, input }) => createRelease(ctx.staffUser, input)),
    releaseStatus: developerProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["uploaded", "testing", "approved", "deployed", "rolled_back"]) })).mutation(({ ctx, input }) => updateReleaseStatus(ctx.staffUser, input)),
    releaseInspect: developerProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => inspectRelease(ctx.staffUser, input.id)),
  }),
  system: systemRouter,
  communications: communicationsRouter,
  notifications: notificationsRouter,
  nativePush: nativePushRouter,
  integration: integrationRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => ctx.staffUser),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().min(1).max(320),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const session = await authenticateStaff(
          input.username,
          input.password,
          ctx.req.ip || "unknown"
        );
        ctx.res.cookie(STAFF_SESSION_COOKIE, session.token, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: STAFF_SESSION_TTL_MS,
        });
        return { user: session.user };
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await revokeStaffSession(readStaffToken(ctx.req.headers.cookie));
      ctx.res.clearCookie(STAFF_SESSION_COOKIE, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: 0,
      });
      return { success: true } as const;
    }),
    setEmail: staffProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(128),
          email: emailInput.nullable(),
        })
      )
      .mutation(({ ctx, input }) =>
        setOwnStaffEmail(ctx.staffUser.id, input.currentPassword, input.email)
      ),
    changePassword: staffProcedure
      .input(
        z.object({
          currentPassword: z.string().min(1).max(128),
          newPassword: newPasswordInput,
        })
      )
      .mutation(({ ctx, input }) =>
        changeOwnStaffPassword(
          ctx.staffUser.id,
          ctx.staffSessionHash,
          input.currentPassword,
          input.newPassword
        )
      ),
  }),
  branches: router({
    list: staffProcedure.query(({ ctx }) => listBranches(ctx.staffUser)),
    create: systemAdminProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          city: z.string().trim().min(1).max(120),
          ordersEnabled: z.boolean().default(true),
        })
      )
      .mutation(({ ctx, input }) => createBranch(ctx.staffUser, input)),
    update: systemAdminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(1).max(120).optional(),
          city: z.string().trim().min(1).max(120).optional(),
          ordersEnabled: z.boolean().optional(),
        })
      )
      .mutation(({ ctx, input }) => updateBranch(ctx.staffUser, input)),
  }),
  staff: router({
    list: staffManagementProcedure
      .input(
        z
          .object({
            branchId: branchIdInput,
            scope: z
              .enum(["all", "system", "branch_managers", "branch"])
              .optional(),
          })
          .optional()
      )
      .query(({ ctx, input }) =>
        listStaffAccounts(ctx.staffUser, input?.branchId, input?.scope)
      ),
    create: staffManagementProcedure
      .input(
        z.object({
          username: usernameInput,
          displayName: z.string().trim().min(1).max(120),
          password: newPasswordInput,
          usualShift: usualShiftInput.nullable().optional(),
          ...roleStaffInput.shape,
        })
      )
      .mutation(({ ctx, input }) => createStaffAccount(ctx.staffUser, input)),
    update: staffManagementProcedure
      .input(
        z
          .object({
            id: z.number().int().positive(),
            username: usernameInput.optional(),
            displayName: z.string().trim().min(1).max(120).optional(),
            password: newPasswordInput.optional(),
            role: roleInput.optional(),
            branchId: z.number().int().positive().nullable().optional(),
            usualShift: usualShiftInput.nullable().optional(),
            isActive: z.boolean().optional(),
            canStation: z.boolean().optional(),
            canKitchen: z.boolean().optional(),
            canManager: z.boolean().optional(),
          })
          .refine(
            value => Object.keys(value).some(key => key !== "id"),
            "أرسل حقلًا واحدًا على الأقل للتعديل."
          )
      )
      .mutation(({ ctx, input }) => updateStaffAccount(ctx.staffUser, input)),
  }),
  products: router({
    list: stationProcedure
      .input(z.object({ branchId: branchIdInput }).optional())
      .query(({ ctx, input }) =>
        listProducts(ctx.staffUser, false, input?.branchId)
      ),
    managerList: managerProcedure
      .input(z.object({ branchId: branchIdInput }).optional())
      .query(({ ctx, input }) =>
        listProducts(ctx.staffUser, true, input?.branchId)
      ),
    create: staffManagementProcedure
      .input(productInput)
      .mutation(({ ctx, input }) => createProduct(ctx.staffUser, input)),
    update: staffManagementProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          name: z.string().trim().min(1).max(120).optional(),
          category: z.string().trim().min(1).max(80).optional(),
          prepMinutes: z.number().int().min(0).max(240).optional(),
          graceMinutes: z.number().int().min(0).max(240).optional(),
          hasTimer: z.boolean().optional(),
          isActive: z.boolean().optional(),
          branchId: branchIdInput,
        })
      )
      .mutation(({ ctx, input }) => updateProduct(ctx.staffUser, input)),
  }),
  orders: router({
    station: stationProcedure
      .input(z.object({ branchId: branchIdInput }).optional())
      .query(({ ctx, input }) =>
        listStationOrders(ctx.staffUser, input?.branchId)
      ),
    kitchen: kitchenProcedure
      .input(z.object({ branchId: branchIdInput }).optional())
      .query(({ ctx, input }) =>
        listKitchenOrders(ctx.staffUser, input?.branchId)
      ),
    monitor: monitorProcedure
      .input(z.object({ branchId: branchIdInput }).optional())
      .query(({ ctx, input }) =>
        listKitchenOrders(ctx.staffUser, input?.branchId)
      ),
    stationHistory: stationProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).max(100000).default(0),
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional(),
            branchId: branchIdInput,
          })
          .optional()
      )
      .query(({ ctx, input }) =>
        listHistory(ctx.staffUser, {
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
          from: input?.from,
          to: input?.to,
          branchId: input?.branchId,
        })
      ),
    history: managerProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).max(100000).default(0),
            from: z.coerce.date().optional(),
            to: z.coerce.date().optional(),
            branchId: branchIdInput,
          })
          .optional()
      )
      .query(({ ctx, input }) =>
        listHistory(ctx.staffUser, {
          limit: input?.limit ?? 50,
          offset: input?.offset ?? 0,
          from: input?.from,
          to: input?.to,
          branchId: input?.branchId,
        })
      ),
    voiceNote: orderReadProcedure
      .input(
        z.object({
          orderId: z.number().int().positive(),
          branchId: branchIdInput,
        })
      )
      .query(({ ctx, input }) =>
        getOrderVoiceNote(ctx.staffUser, input.orderId, input.branchId)
      ),
    create: orderEntryProcedure
      .input(
        z.object({
          items: z
            .array(
              z.object({
                productId: z.number().int().positive(),
                quantity: z.number().int().min(1).max(99),
              })
            )
            .min(1)
            .max(30),
          notes: z.string().max(1000).optional(),
          voiceData: z.string().max(7_000_000).optional(),
          voiceType: z
            .enum(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"])
            .optional(),
          branchId: branchIdInput,
        })
      )
      .mutation(({ ctx, input }) => createOrder(ctx.staffUser, input)),
    transition: kitchenProcedure
      .input(
        z.object({
          orderId: z.number().int().positive(),
          nextStatus: z.enum(["preparing", "ready"]),
          actor: z.string().max(120).optional(),
          branchId: branchIdInput,
        })
      )
      .mutation(({ ctx, input }) =>
        transitionOrder(ctx.staffUser, {
          ...input,
          actor: ctx.staffUser.displayName,
        })
      ),
    receive: receiveProcedure
      .input(
        z.object({
          orderId: z.number().int().positive(),
          branchId: branchIdInput,
        })
      )
      .mutation(({ ctx, input }) => receiveOrder(ctx.staffUser, input)),
    extend: extendProcedure
      .input(
        z.object({
          orderId: z.number().int().positive(),
          minutes: z.number().int().min(1).max(240),
          reason: z.string().trim().min(1).max(500),
          branchId: branchIdInput,
        })
      )
      .mutation(({ ctx, input }) => extendOrder(ctx.staffUser, input)),
  }),
});

export type AppRouter = typeof appRouter;
