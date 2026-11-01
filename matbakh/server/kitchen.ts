import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import {
  kitchenOrderEvents,
  kitchenOrderItems,
  kitchenOrders,
  products,
  type KitchenOrder,
} from "../drizzle/schema";
import {
  addMinutes,
  graceDueAt,
  isOverdue,
  preparationDueAt,
} from "../shared/order-time";
import {
  isKitchenManager,
  isSystemAdmin,
  roleOf,
  type StaffRole,
} from "../shared/roles";
import {
  assertBranchOrdersEnabled,
  getBranch,
  resolveBranchId,
  type BranchActor,
} from "./branches";
import { getDb } from "./db";
import { emitNotification } from "./notifications";
import { ticketLabel } from "../shared/ticket-label";

const orderColumns = {
  id: kitchenOrders.id,
  branchId: kitchenOrders.branchId,
  orderCode: kitchenOrders.orderCode,
  status: kitchenOrders.status,
  orderSource: kitchenOrders.orderSource,
  createdById: kitchenOrders.createdById,
  createdByName: kitchenOrders.createdByName,
  notes: kitchenOrders.notes,
  createdAt: kitchenOrders.createdAt,
  acceptedAt: kitchenOrders.acceptedAt,
  acceptedById: kitchenOrders.acceptedById,
  readyAt: kitchenOrders.readyAt,
  receivedAt: kitchenOrders.receivedAt,
  receivedById: kitchenOrders.receivedById,
  receivedByName: kitchenOrders.receivedByName,
  extensionMinutes: kitchenOrders.extensionMinutes,
  originalDueAt: kitchenOrders.originalDueAt,
  effectiveDueAt: kitchenOrders.effectiveDueAt,
  everOverdue: kitchenOrders.everOverdue,
  externalOrderId: kitchenOrders.externalOrderId,
  externalItemId: kitchenOrders.externalItemId,
  syncStatus: kitchenOrders.syncStatus,
  voiceAvailable: sql<boolean>`CASE WHEN ${kitchenOrders.voiceData} IS NULL THEN 0 ELSE 1 END`,
};
type OrderListRow = Omit<KitchenOrder, "voiceData" | "voiceType"> & {
  voiceAvailable: boolean | number;
};

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "قاعدة البيانات غير متاحة.",
    });
  return db;
}

function actorBranchFilter(
  actor: BranchActor,
  requestedBranchId?: number | null
) {
  return isSystemAdmin(actor)
    ? (requestedBranchId ?? null)
    : resolveBranchId(actor, requestedBranchId);
}

function orderActorName(actor: BranchActor) {
  return actor.displayName?.trim().slice(0, 120) || "موظف الوردية";
}

function dateForCode(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

async function notifySafely(input: Parameters<typeof emitNotification>[0]) {
  try {
    await emitNotification(input);
  } catch {
    /* notification failure never rolls back order data */
  }
}

export async function listProducts(
  actor: BranchActor,
  includeInactive = false,
  requestedBranchId?: number | null
) {
  const db = await requireDb();
  const branchId = actorBranchFilter(actor, requestedBranchId);
  const conditions = [] as ReturnType<typeof eq>[];
  if (branchId != null) conditions.push(eq(products.branchId, branchId));
  if (!includeInactive) conditions.push(eq(products.isActive, true));
  return db
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(products.sortOrder), asc(products.id));
}

export async function createProduct(
  actor: BranchActor,
  input: {
    name: string;
    category: string;
    prepMinutes: number;
    graceMinutes?: number;
    hasTimer?: boolean;
    branchId?: number | null;
  }
) {
  const db = await requireDb();
  const branchId = resolveBranchId(actor, input.branchId);
  await getBranch(branchId);
  const name = input.name.trim();
  if (!name)
    throw new TRPCError({ code: "BAD_REQUEST", message: "اسم الصنف مطلوب." });
  try {
    if (input.hasTimer === false && input.prepMinutes !== 0)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "الصنف المباشر يجب أن تكون مدة تحضيره صفرًا.",
      });
    const result = await db.insert(products).values({
      name,
      category: input.category.trim(),
      prepMinutes: input.prepMinutes,
      graceMinutes: input.graceMinutes ?? 5,
      hasTimer: input.hasTimer ?? true,
      branchId,
      isActive: true,
    });
    return Number(result[0].insertId);
  } catch (error) {
    if (String(error).toLowerCase().includes("duplicate"))
      throw new TRPCError({
        code: "CONFLICT",
        message: "يوجد صنف بهذا الاسم في الفرع.",
      });
    throw error;
  }
}

export async function updateProduct(
  actor: BranchActor,
  input: {
    id: number;
    name?: string;
    category?: string;
    prepMinutes?: number;
    graceMinutes?: number;
    hasTimer?: boolean;
    isActive?: boolean;
    branchId?: number | null;
  }
) {
  const db = await requireDb();
  const branchId = actorBranchFilter(actor, input.branchId);
  if (branchId != null) await getBranch(branchId);
  const changes: Partial<typeof products.$inferInsert> = {};
  if (input.name !== undefined) changes.name = input.name.trim();
  if (input.category !== undefined) changes.category = input.category.trim();
  if (input.prepMinutes !== undefined) changes.prepMinutes = input.prepMinutes;
  if (input.graceMinutes !== undefined)
    changes.graceMinutes = input.graceMinutes;
  if (input.hasTimer !== undefined) changes.hasTimer = input.hasTimer;
  if (input.hasTimer === false) {
    changes.prepMinutes = 0;
    changes.graceMinutes = 0;
  }
  if (input.hasTimer === true && input.prepMinutes === 0)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "الصنف الذي يحتاج مؤقتًا يجب أن تكون مدة تحضيره أكبر من صفر.",
    });
  if (input.isActive !== undefined) changes.isActive = input.isActive;
  if (!Object.keys(changes).length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "أرسل حقلًا واحدًا على الأقل للتعديل.",
    });
  const where =
    branchId == null
      ? eq(products.id, input.id)
      : and(eq(products.id, input.id), eq(products.branchId, branchId));
  const result = await db.update(products).set(changes).where(where);
  if (result[0].affectedRows !== 1)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "الصنف غير موجود في هذا الفرع.",
    });
  return { success: true } as const;
}

async function hydrateOrders(rows: OrderListRow[]) {
  const db = await getDb();
  if (!db || rows.length === 0) return [];
  const ids = rows.map(row => row.id);
  const [items, events] = await Promise.all([
    db
      .select()
      .from(kitchenOrderItems)
      .where(inArray(kitchenOrderItems.orderId, ids))
      .orderBy(asc(kitchenOrderItems.id)),
    db
      .select()
      .from(kitchenOrderEvents)
      .where(inArray(kitchenOrderEvents.orderId, ids))
      .orderBy(asc(kitchenOrderEvents.createdAt), asc(kitchenOrderEvents.id)),
  ]);
  return rows.map(order => ({
    ...order,
    voiceAvailable: Boolean(order.voiceAvailable),
    items: items.filter(item => item.orderId === order.id),
    events: events.filter(event => event.orderId === order.id),
  }));
}

export async function listStationOrders(
  actor: BranchActor,
  requestedBranchId?: number | null
) {
  const db = await requireDb();
  const branchId = actorBranchFilter(actor, requestedBranchId);
  const conditions = [ne(kitchenOrders.status, "received")] as ReturnType<
    typeof ne
  >[];
  if (branchId != null)
    conditions.push(
      eq(kitchenOrders.branchId, branchId) as ReturnType<typeof ne>
    );
  const rows = await db
    .select(orderColumns)
    .from(kitchenOrders)
    .where(and(...conditions))
    .orderBy(asc(kitchenOrders.createdAt))
    .limit(500);
  return hydrateOrders(rows);
}

export async function listKitchenOrders(
  actor: BranchActor,
  requestedBranchId?: number | null
) {
  const db = await requireDb();
  const branchId = actorBranchFilter(actor, requestedBranchId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const conditions = [
    ne(kitchenOrders.status, "received"),
    gt(kitchenOrders.createdAt, since),
  ] as ReturnType<typeof ne>[];
  if (branchId != null)
    conditions.push(
      eq(kitchenOrders.branchId, branchId) as ReturnType<typeof ne>
    );
  const rows = await db
    .select(orderColumns)
    .from(kitchenOrders)
    .where(and(...conditions))
    .orderBy(asc(kitchenOrders.createdAt))
    .limit(500);
  return hydrateOrders(rows);
}

export async function listHistory(
  actor: BranchActor,
  input: {
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
    branchId?: number | null;
  }
) {
  const db = await requireDb();
  const branchId = actorBranchFilter(actor, input.branchId);
  const conditions = [
    or(eq(kitchenOrders.status, "ready"), eq(kitchenOrders.status, "received")),
  ] as ReturnType<typeof eq>[];
  if (branchId != null) conditions.push(eq(kitchenOrders.branchId, branchId));
  if (input.from) conditions.push(gt(kitchenOrders.createdAt, input.from));
  if (input.to) conditions.push(lt(kitchenOrders.createdAt, input.to));
  const [rows, countRows] = await Promise.all([
    db
      .select(orderColumns)
      .from(kitchenOrders)
      .where(and(...conditions))
      .orderBy(desc(kitchenOrders.createdAt), desc(kitchenOrders.id))
      .limit(input.limit)
      .offset(input.offset),
    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(kitchenOrders)
      .where(and(...conditions)),
  ]);
  return {
    orders: await hydrateOrders(rows),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function getOrderVoiceNote(
  actor: BranchActor,
  orderId: number,
  requestedBranchId?: number | null
) {
  const db = await requireDb();
  const branchId = actorBranchFilter(actor, requestedBranchId);
  const where =
    branchId == null
      ? eq(kitchenOrders.id, orderId)
      : and(
          eq(kitchenOrders.id, orderId),
          eq(kitchenOrders.branchId, branchId)
        );
  const [row] = await db
    .select({
      voiceData: kitchenOrders.voiceData,
      voiceType: kitchenOrders.voiceType,
    })
    .from(kitchenOrders)
    .where(where)
    .limit(1);
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "التذكرة غير موجودة في هذا الفرع.",
    });
  if (!row.voiceData || !row.voiceType) return null;
  return {
    data: Buffer.from(row.voiceData).toString("base64"),
    type: row.voiceType,
  };
}

export async function createOrder(
  actor: BranchActor,
  input: {
    items: Array<{ productId: number; quantity: number }>;
    notes?: string;
    voiceData?: string;
    voiceType?: string;
    branchId?: number | null;
  }
) {
  const branchId = resolveBranchId(actor, input.branchId);
  await assertBranchOrdersEnabled(branchId);
  const db = await requireDb();
  if (input.voiceData && input.voiceData.length > 7_000_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "حجم التسجيل أكبر من الحد المسموح.",
    });
  const voiceData = input.voiceData
    ? Buffer.from(input.voiceData, "base64")
    : null;
  if (voiceData && voiceData.length > 5 * 1024 * 1024)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "حجم التسجيل أكبر من 5 ميغابايت.",
    });
  const created = await db.transaction(async tx => {
    const ids = input.items.map(item => item.productId);
    if (new Set(ids).size !== ids.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "لا تكرر الصنف في التذكرة.",
      });
    const found = await tx
      .select()
      .from(products)
      .where(
        and(
          inArray(products.id, ids),
          eq(products.branchId, branchId),
          eq(products.isActive, true)
        )
      );
    if (found.length !== new Set(ids).size)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "يوجد صنف غير متاح في هذا الفرع؛ حدّث القائمة وحاول مجددًا.",
      });
    const byId = new Map(found.map(product => [product.id, product]));
    const createdOrders: Array<{ id: number; orderCode: string }> = [];
    for (const item of input.items) {
      const product = byId.get(item.productId)!;
      const createdAt = new Date();
      const inserted = await tx.insert(kitchenOrders).values({
        branchId,
        orderCode: `TMP-${nanoid(16)}`,
        status: "new",
        orderSource: isKitchenManager(actor) ? "kitchen_manager" : "internal",
        createdById: actor.id,
        createdByName: orderActorName(actor),
        notes: input.notes?.trim() || null,
        voiceData,
        voiceType: voiceData ? (input.voiceType ?? "audio/webm") : null,
        createdAt,
        syncStatus: "not_required",
      });
      const orderId = Number(inserted[0].insertId);
      const orderCode = `S-${dateForCode(createdAt)}-${orderId}`;
      await tx
        .update(kitchenOrders)
        .set({ orderCode })
        .where(eq(kitchenOrders.id, orderId));
      await tx.insert(kitchenOrderItems).values({
        orderId,
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        prepMinutes: product.prepMinutes,
        graceMinutes: product.graceMinutes,
        hasTimer: product.hasTimer,
      });
      await tx.insert(kitchenOrderEvents).values({
        orderId,
        status: "new",
        kind: "created",
        actorId: actor.id,
        actor: orderActorName(actor),
        createdAt,
        detail: "أُرسل الصنف كتذكرة مستقلة إلى المطبخ",
      });
      createdOrders.push({ id: orderId, orderCode });
    }
    return createdOrders;
  });
  for (const order of created)
    await notifySafely({
      branchId,
      orderId: order.id,
      type: "order_created",
      title: "تذكرة جديدة",
      body: `وصلت ${ticketLabel(order)} إلى المطبخ.`,
      targetSection: "kitchen",
      dedupeKey: `order-created:${order.id}`,
    });
  return { orders: created };
}

export async function transitionOrder(
  actor: BranchActor,
  input: {
    orderId: number;
    nextStatus: "preparing" | "ready";
    actor?: string;
    branchId?: number | null;
  }
) {
  const db = await requireDb();
  const branchId = isSystemAdmin(actor)
    ? (input.branchId ?? null)
    : resolveBranchId(actor, input.branchId);
  const result = await db.transaction(async tx => {
    const where =
      branchId == null
        ? eq(kitchenOrders.id, input.orderId)
        : and(
            eq(kitchenOrders.id, input.orderId),
            eq(kitchenOrders.branchId, branchId)
          );
    const [order] = await tx
      .select()
      .from(kitchenOrders)
      .where(where)
      .limit(1)
      .for("update");
    if (!order)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "التذكرة غير موجودة في هذا الفرع.",
      });
    const allowed =
      (order.status === "new" && input.nextStatus === "preparing") ||
      (order.status === "preparing" && input.nextStatus === "ready");
    if (!allowed)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "تم تحديث حالة التذكرة من شاشة أخرى؛ حدّث الصفحة.",
      });
    const now = new Date();
    const item = (
      await tx
        .select()
        .from(kitchenOrderItems)
        .where(eq(kitchenOrderItems.orderId, order.id))
        .limit(1)
    )[0];
    if (!item)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "التذكرة بلا صنف.",
      });
    const actorName =
      input.actor?.trim().slice(0, 120) || orderActorName(actor);
    const dueAt = item.hasTimer !== false && order.acceptedAt
      ? preparationDueAt(
          order.acceptedAt,
          item.prepMinutes,
          order.extensionMinutes
        )
      : null;
    const nextDue =
      item.hasTimer !== false && input.nextStatus === "preparing"
        ? preparationDueAt(now, item.prepMinutes, order.extensionMinutes)
        : dueAt;
    const update =
      input.nextStatus === "preparing"
        ? {
            status: "preparing" as const,
            acceptedAt: now,
            acceptedById: actor.id,
            originalDueAt: nextDue,
            effectiveDueAt: nextDue,
          }
        : {
            status: "ready" as const,
            readyAt: now,
            originalDueAt: order.originalDueAt ?? nextDue,
            effectiveDueAt: order.effectiveDueAt ?? nextDue,
            everOverdue: item.hasTimer !== false
              ? order.everOverdue ||
                Boolean(
                  (order.effectiveDueAt ?? nextDue) &&
                    isOverdue(now, (order.effectiveDueAt ?? nextDue)!)
                )
              : false,
          };
    const updateResult = await tx
      .update(kitchenOrders)
      .set(update)
      .where(
        and(
          eq(kitchenOrders.id, order.id),
          eq(kitchenOrders.status, order.status)
        )
      );
    if (updateResult[0].affectedRows !== 1)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "تم تحديث حالة التذكرة من شاشة أخرى؛ حدّث الصفحة.",
      });
    await tx.insert(kitchenOrderEvents).values({
      orderId: order.id,
      status: input.nextStatus,
      kind: input.nextStatus === "preparing" ? "accepted" : "ready",
      actorId: actor.id,
      actor: actorName,
      createdAt: now,
      newDueAt: nextDue,
      detail:
        input.nextStatus === "preparing"
          ? "استُلمت التذكرة وبدأ التحضير"
          : "أصبحت التذكرة جاهزة",
    });
    if (order.orderSource === "external") {
      const { integrationOutbox } = await import(
        "../drizzle/integration-schema"
      );
      await tx.insert(integrationOutbox).values({
        branchId: order.branchId!,
        orderId: order.id,
        eventType: `order.${input.nextStatus}`,
        payload: JSON.stringify({
          orderId: order.id,
          orderCode: order.orderCode,
          externalOrderId: order.externalOrderId,
          externalItemId: order.externalItemId,
          status: input.nextStatus,
          occurredAt: now.toISOString(),
        }),
        status: "pending",
      });
    }
    return {
      branchId: order.branchId!,
      orderCode: order.orderCode,
      dueAt: nextDue,
    };
  });
  await notifySafely({
    branchId: result.branchId,
    orderId: input.orderId,
    type: input.nextStatus === "preparing" ? "order_created" : "ready",
    title: input.nextStatus === "preparing" ? "بدأ التحضير" : "التذكرة جاهزة",
    body: `${ticketLabel({ id: input.orderId })} — ${input.nextStatus === "preparing" ? "تم قبولها في المطبخ." : "بانتظار استلام السخان."}`,
    targetSection: input.nextStatus === "preparing" ? "kitchen" : "station",
    dedupeKey: `${input.nextStatus}:${input.orderId}`,
  });
  return { success: true } as const;
}

export async function receiveOrder(
  actor: BranchActor,
  input: { orderId: number; branchId?: number | null }
) {
  const db = await requireDb();
  const branchId = isSystemAdmin(actor)
    ? (input.branchId ?? null)
    : resolveBranchId(actor, input.branchId);
  const result = await db.transaction(async tx => {
    const where =
      branchId == null
        ? eq(kitchenOrders.id, input.orderId)
        : and(
            eq(kitchenOrders.id, input.orderId),
            eq(kitchenOrders.branchId, branchId)
          );
    const [order] = await tx
      .select()
      .from(kitchenOrders)
      .where(where)
      .limit(1)
      .for("update");
    if (!order)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "التذكرة غير موجودة في هذا الفرع.",
      });
    if (order.status !== "ready")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "لا يمكن تأكيد الاستلام قبل جاهزية التذكرة.",
      });
    const now = new Date();
    const updateResult = await tx
      .update(kitchenOrders)
      .set({
        status: "received",
        receivedAt: now,
        receivedById: actor.id,
        receivedByName: orderActorName(actor),
      })
      .where(
        and(eq(kitchenOrders.id, order.id), eq(kitchenOrders.status, "ready"))
      );
    if (updateResult[0].affectedRows !== 1)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "تم استلام التذكرة من شاشة أخرى.",
      });
    await tx.insert(kitchenOrderEvents).values({
      orderId: order.id,
      status: "received",
      kind: "received",
      actorId: actor.id,
      actor: orderActorName(actor),
      createdAt: now,
      detail: "أكد السخان استلام التذكرة الجاهزة",
    });
    if (order.orderSource === "external") {
      const { integrationOutbox } = await import(
        "../drizzle/integration-schema"
      );
      await tx.insert(integrationOutbox).values({
        branchId: order.branchId!,
        orderId: order.id,
        eventType: "order.received",
        payload: JSON.stringify({
          orderId: order.id,
          orderCode: order.orderCode,
          externalOrderId: order.externalOrderId,
          externalItemId: order.externalItemId,
          status: "received",
          receivedAt: now.toISOString(),
        }),
        status: "pending",
      });
    }
    return { branchId: order.branchId!, orderCode: order.orderCode };
  });
  await notifySafely({
    branchId: result.branchId,
    orderId: input.orderId,
    type: "received",
    title: "تم استلام التذكرة",
    body: `${ticketLabel({ id: input.orderId })} — أكد السخان الاستلام.`,
    targetSection: "all",
    dedupeKey: `received:${input.orderId}`,
  });
  return { success: true } as const;
}

export async function extendOrder(
  actor: BranchActor,
  input: {
    orderId: number;
    minutes: number;
    reason: string;
    branchId?: number | null;
  }
) {
  if (!isKitchenManager(actor) && !isSystemAdmin(actor))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "تمديد المهلة متاح لمدير المطبخ أو مدير النظام الأعلى.",
    });
  const db = await requireDb();
  const branchId = isSystemAdmin(actor)
    ? (input.branchId ?? null)
    : resolveBranchId(actor, input.branchId);
  const result = await db.transaction(async tx => {
    const where =
      branchId == null
        ? eq(kitchenOrders.id, input.orderId)
        : and(
            eq(kitchenOrders.id, input.orderId),
            eq(kitchenOrders.branchId, branchId)
          );
    const [order] = await tx
      .select()
      .from(kitchenOrders)
      .where(where)
      .limit(1)
      .for("update");
    if (!order)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "التذكرة غير موجودة في هذا الفرع.",
      });
    if (order.status !== "preparing")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "التمديد متاح لتذكرة قيد التحضير فقط، ولو تجاوزت السماح.",
      });
    const item = (
      await tx
        .select()
        .from(kitchenOrderItems)
        .where(eq(kitchenOrderItems.orderId, order.id))
        .limit(1)
    )[0];
    if (
      !item ||
      !Number.isInteger(input.minutes) ||
      input.minutes < 1 ||
      input.minutes > 240
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "مدة التمديد بين دقيقة و240 دقيقة.",
      });
    if (item.hasTimer === false)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "الطلب المباشر لا يحتاج إلى تمديد زمني.",
      });
    const previousDueAt =
      order.effectiveDueAt ??
      (order.acceptedAt
        ? preparationDueAt(
            order.acceptedAt,
            item.prepMinutes,
            order.extensionMinutes
          )
        : null);
    if (!previousDueAt)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "لا يمكن تمديد تذكرة لم يبدأ تحضيرها.",
      });
    const newDueAt = addMinutes(previousDueAt, input.minutes);
    const everOverdue =
      order.everOverdue ||
      isOverdue(new Date(), previousDueAt);
    await tx
      .update(kitchenOrders)
      .set({
        extensionMinutes: order.extensionMinutes + input.minutes,
        originalDueAt: order.originalDueAt ?? previousDueAt,
        effectiveDueAt: newDueAt,
        everOverdue,
      })
      .where(eq(kitchenOrders.id, order.id));
    await tx.insert(kitchenOrderEvents).values({
      orderId: order.id,
      status: order.status,
      kind: "extended",
      actorId: actor.id,
      actor: orderActorName(actor),
      createdAt: new Date(),
      previousDueAt,
      newDueAt,
      addedMinutes: input.minutes,
      reason: input.reason.trim().slice(0, 500),
      detail: `تمديد ${input.minutes} دقيقة`,
    });
    return { branchId: order.branchId!, orderCode: order.orderCode, newDueAt };
  });
  await notifySafely({
    branchId: result.branchId,
    orderId: input.orderId,
    type: "extended",
    title: "تم تمديد المهلة",
    body: `${ticketLabel({ id: input.orderId })} — أضيفت ${input.minutes} دقيقة.`,
    targetSection: "kitchen",
    dedupeKey: `extended:${input.orderId}:${result.newDueAt.toISOString()}`,
  });
  return { success: true, effectiveDueAt: result.newDueAt } as const;
}
