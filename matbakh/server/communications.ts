import { and, asc, desc, eq, getTableColumns, gt, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Express } from "express";
import {
  broadcasts,
  broadcastChunks,
  broadcastListens,
} from "../drizzle/communications-schema";
import { branches, kitchenOrders } from "../drizzle/schema";
import { getDb } from "./db";
import { staffProcedure, router } from "./_core/trpc";
import {
  getStaffSessionContext,
  STAFF_SESSION_COOKIE,
  type StaffSessionUser,
} from "./staff";
import { emitNotification } from "./notifications";
import {
  BROADCAST_IDLE_MS,
  BROADCAST_MAX_BYTES,
  BROADCAST_MAX_SECONDS,
  BROADCAST_SAMPLE_RATE,
  createWavHeader,
  validateAudioPacket,
} from "../shared/broadcast-audio";

const managerRoles = [
  "developer",
  "system_admin",
  "branch_manager",
  "kitchen_manager",
  "shift_manager",
];
const sectionInput = z.enum(["station", "kitchen"]);
async function requireDatabase() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "قاعدة البيانات غير متاحة.",
    });
  return db;
}
function requireActor(actor: StaffSessionUser) {
  if (!actor.isActive || actor.mustChangePassword)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "سجّل الدخول وغيّر كلمة المرور المؤقتة أولًا.",
    });
}
export function canReadBroadcast(
  actor: Pick<StaffSessionUser, "role" | "branchId">,
  row: { branchId: number; targetSection: "station" | "kitchen" }
) {
  if (actor.role === "system_admin" || actor.role === "developer") return true;
  if (actor.branchId !== row.branchId) return false;
  return managerRoles.includes(actor.role) || actor.role === row.targetSection;
}
function requireScope(
  actor: StaffSessionUser,
  branchId: number,
  targetSection?: "station" | "kitchen"
) {
  requireActor(actor);
  if (actor.role !== "system_admin" && actor.role !== "developer" && actor.branchId !== branchId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "هذا الفرع غير مصرح لحسابك.",
    });
  if (targetSection && !canReadBroadcast(actor, { branchId, targetSection }))
    throw new TRPCError({ code: "FORBIDDEN", message: "البث مخصص لقسم آخر." });
}
async function scopedBroadcast(actor: StaffSessionUser, id: number) {
  const db = await requireDatabase();
  const [row] = await db
    .select()
    .from(broadcasts)
    .where(eq(broadcasts.id, id))
    .limit(1);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "البث غير موجود." });
  requireScope(actor, row.branchId, row.targetSection);
  return row;
}
async function expireStale(branchId: number) {
  const db = await requireDatabase();
  await db
    .update(broadcasts)
    .set({ status: "interrupted", endedAt: new Date() })
    .where(
      and(
        eq(broadcasts.branchId, branchId),
        eq(broadcasts.status, "live"),
        lt(broadcasts.lastChunkAt, new Date(Date.now() - BROADCAST_IDLE_MS))
      )
    );
}

export const communicationsRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          branchId: z.number().int().positive().optional(),
          orderId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const actor = ctx.staffUser;
      requireActor(actor);
      const branchId = input?.branchId ?? actor.branchId;
      if (!branchId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "اختر الفرع." });
      requireScope(actor, branchId);
      await expireStale(branchId);
      const db = await requireDatabase();
      const conditions = [eq(broadcasts.branchId, branchId)];
      if (input?.orderId) {
        const [order] = await db
          .select({ branchId: kitchenOrders.branchId })
          .from(kitchenOrders)
          .where(eq(kitchenOrders.id, input.orderId))
          .limit(1);
        if (!order || order.branchId !== branchId)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "التذكرة غير موجودة في هذا الفرع.",
          });
        conditions.push(eq(broadcasts.orderId, input.orderId));
      }
      if (!managerRoles.includes(actor.role))
        conditions.push(
          eq(
            broadcasts.targetSection,
            actor.role === "kitchen" ? "kitchen" : "station"
          )
        );
      return db
        .select({
          ...getTableColumns(broadcasts),
          orderCode: kitchenOrders.orderCode,
        })
        .from(broadcasts)
        .leftJoin(
          kitchenOrders,
          and(
            eq(kitchenOrders.id, broadcasts.orderId),
            eq(kitchenOrders.branchId, broadcasts.branchId)
          )
        )
        .where(and(...conditions))
        .orderBy(desc(broadcasts.startedAt))
        .limit(100);
    }),
  start: staffProcedure
    .input(
      z.object({
        branchId: z.number().int().positive().optional(),
        targetSection: sectionInput,
        orderId: z.number().int().positive().optional(),
        title: z.string().trim().min(1).max(160).default("بث مباشر للقسم"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = ctx.staffUser;
      requireActor(actor);
      if (!managerRoles.includes(actor.role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "البث متاح للأدوار الإدارية فقط.",
        });
      const branchId = input.branchId ?? actor.branchId;
      if (!branchId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "اختر الفرع." });
      requireScope(actor, branchId);
      await expireStale(branchId);
      const db = await requireDatabase();
      const result = await db.transaction(async tx => {
        const [branch] = await tx
          .select()
          .from(branches)
          .where(eq(branches.id, branchId))
          .for("update");
        if (!branch)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "الفرع غير موجود.",
          });
        const [active] = await tx
          .select({ id: broadcasts.id })
          .from(broadcasts)
          .where(
            and(
              eq(broadcasts.branchId, branchId),
              eq(broadcasts.targetSection, input.targetSection),
              eq(broadcasts.status, "live")
            )
          )
          .limit(1);
        if (active)
          throw new TRPCError({
            code: "CONFLICT",
            message: "يوجد بث جارٍ لهذا القسم؛ انتظر انتهاءه.",
          });
        if (input.orderId) {
          const [order] = await tx
            .select({ branchId: kitchenOrders.branchId })
            .from(kitchenOrders)
            .where(eq(kitchenOrders.id, input.orderId))
            .limit(1);
          if (!order || order.branchId !== branchId)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "التذكرة لا تتبع الفرع المحدد.",
            });
        }
        const inserted = await tx.insert(broadcasts).values({
          branchId,
          senderId: actor.id,
          senderName: actor.displayName,
          targetSection: input.targetSection,
          orderId: input.orderId ?? null,
          title: input.title,
        });
        return {
          id: Number(inserted[0].insertId),
          branchId,
          sampleRate: BROADCAST_SAMPLE_RATE,
        };
      });
      await emitNotification({
        branchId,
        orderId: input.orderId,
        type: "broadcast_started",
        title: `بث مباشر من ${actor.displayName}`,
        body: `${input.title} — البث مسجّل`,
        targetSection: input.targetSection,
        dedupeKey: `broadcast:${result.id}`,
      }).catch(() => undefined);
      return result;
    }),
  pushAudio: staffProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        sequence: z
          .number()
          .int()
          .min(0)
          .max(BROADCAST_MAX_SECONDS * 10),
        data: z.string().min(1).max(45_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = ctx.staffUser;
      const row = await scopedBroadcast(actor, input.id);
      if (row.senderId !== actor.id || !managerRoles.includes(actor.role))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "لا يمكنك إرسال صوت باسم مستخدم آخر.",
        });
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "بيانات الصوت غير صالحة.",
        });
      const data = Buffer.from(input.data, "base64");
      try {
        validateAudioPacket(data);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (error as Error).message,
        });
      }
      const db = await requireDatabase();
      return db.transaction(async tx => {
        const [current] = await tx
          .select()
          .from(broadcasts)
          .where(eq(broadcasts.id, input.id))
          .for("update");
        if (!current || current.status !== "live")
          throw new TRPCError({ code: "CONFLICT", message: "انتهى البث." });
        if (input.sequence < current.totalChunks)
          return { saved: true, duplicate: true, sequence: input.sequence };
        if (input.sequence !== current.totalChunks)
          throw new TRPCError({
            code: "CONFLICT",
            message: "دفعات الصوت غير مرتبة؛ حاول إعادة الإرسال.",
          });
        if (
          current.totalBytes + data.length > BROADCAST_MAX_BYTES ||
          Date.now() - current.startedAt.getTime() >
            BROADCAST_MAX_SECONDS * 1000
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "وصل البث إلى حد عشر دقائق.",
          });
        await tx
          .insert(broadcastChunks)
          .values({ broadcastId: input.id, sequence: input.sequence, data });
        await tx
          .update(broadcasts)
          .set({
            totalBytes: current.totalBytes + data.length,
            totalChunks: current.totalChunks + 1,
            lastChunkAt: new Date(),
          })
          .where(eq(broadcasts.id, input.id));
        return { saved: true, duplicate: false, sequence: input.sequence };
      });
    }),
  audioChunks: staffProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        afterSequence: z.number().int().min(-1).default(-1),
      })
    )
    .query(async ({ ctx, input }) => {
      const row = await scopedBroadcast(ctx.staffUser, input.id);
      const db = await requireDatabase();
      const chunks = await db
        .select()
        .from(broadcastChunks)
        .where(
          and(
            eq(broadcastChunks.broadcastId, input.id),
            gt(broadcastChunks.sequence, input.afterSequence)
          )
        )
        .orderBy(asc(broadcastChunks.sequence))
        .limit(12);
      return {
        status: row.status,
        totalChunks: row.totalChunks,
        sampleRate: row.sampleRate,
        chunks: chunks.map(chunk => ({
          sequence: chunk.sequence,
          data: Buffer.from(chunk.data).toString("base64"),
        })),
      };
    }),
  end: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const row = await scopedBroadcast(ctx.staffUser, input.id);
      if (row.senderId !== ctx.staffUser.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "يمكن للمرسل إنهاء بثه فقط.",
        });
      const db = await requireDatabase();
      await db
        .update(broadcasts)
        .set({ status: "ended", endedAt: new Date() })
        .where(and(eq(broadcasts.id, input.id), eq(broadcasts.status, "live")));
      return { success: true };
    }),
  markListened: staffProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await scopedBroadcast(ctx.staffUser, input.id);
      const db = await requireDatabase();
      await db
        .insert(broadcastListens)
        .values({ broadcastId: input.id, userId: ctx.staffUser.id })
        .onDuplicateKeyUpdate({ set: { listenedAt: new Date() } });
      return { success: true };
    }),
});

export function registerCommunicationRoutes(app: Express) {
  app.get("/api/communications/:id/recording.wav", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0)
        return void res.status(400).end();
      const cookie = req.headers.cookie
        ?.split(";")
        .map(value => value.trim())
        .find(value => value.startsWith(`${STAFF_SESSION_COOKIE}=`));
      const session = cookie
        ? await getStaffSessionContext(
            cookie.slice(STAFF_SESSION_COOKIE.length + 1)
          )
        : null;
      if (!session) return void res.status(401).end();
      const row = await scopedBroadcast(session.user, id);
      if (
        row.status === "live" &&
        row.lastChunkAt.getTime() > Date.now() - BROADCAST_IDLE_MS
      )
        return void res
          .status(409)
          .json({ error: "انتظر انتهاء البث لتشغيل تسجيله الكامل." });
      const db = await requireDatabase();
      const data = await db
        .select({ data: broadcastChunks.data })
        .from(broadcastChunks)
        .where(eq(broadcastChunks.broadcastId, id))
        .orderBy(asc(broadcastChunks.sequence));
      const pcm = Buffer.concat(data.map(chunk => Buffer.from(chunk.data)));
      res.set({
        "Content-Type": "audio/wav",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename="broadcast-${id}.wav"`,
        "X-Content-Type-Options": "nosniff",
      });
      res.send(
        Buffer.concat([
          Buffer.from(createWavHeader(pcm.length, row.sampleRate)),
          pcm,
        ])
      );
    } catch (error) {
      const code =
        error instanceof TRPCError ? error.code : "INTERNAL_SERVER_ERROR";
      res
        .status(code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 500)
        .json({ error: "تعذر تشغيل التسجيل أو لا تملك صلاحية الوصول." });
    }
  });
}
