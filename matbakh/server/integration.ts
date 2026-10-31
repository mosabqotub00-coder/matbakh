import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { Express, Request, Response } from "express";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
  integrationApiKeys,
  integrationAttempts,
  integrationKeyAudit,
  integrationOutbox,
  integrationWebhookConfigs,
} from "../drizzle/integration-schema";
import {
  branches,
  kitchenOrderEvents,
  kitchenOrderItems,
  kitchenOrders,
  products,
} from "../drizzle/schema";
import { getDb } from "./db";
import { managerProcedure, router } from "./_core/trpc";

export const EXTERNAL_ACTOR_NAME = "التكامل الخارجي";
export const API_KEY_PREFIX = "mk_live_";
export const PROVIDER_NOT_CONFIGURED_MESSAGE =
  "توثيق UNIFYERP وعنوانه ومصادقته غير متاح بعد؛ الإرسال الخارجي معطل.";

export type IntegrationManagementActor = {
  id: number;
  displayName?: string;
  name?: string;
  role?: string | null;
  branchId?: number | null;
  canManager?: boolean;
  isActive?: boolean;
};

export type ExternalOrderItemInput = {
  externalItemId: string;
  productId: number;
  quantity: number;
};

export type ExternalOrderInput = {
  externalOrderId: string;
  items: ExternalOrderItemInput[];
  notes?: string;
};

export type ExternalOrderResult = {
  orders: Array<{
    id: number;
    orderCode: string;
    externalOrderId: string;
    externalItemId: string;
    productId: number;
    quantity: number;
    status: string;
    created: boolean;
  }>;
};

const externalOrderInputSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(160),
  items: z
    .array(
      z.object({
        externalItemId: z.string().trim().min(1).max(160),
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1)
    .max(100),
  notes: z.string().trim().max(1000).optional(),
});

export const integrationSchemas = {
  externalOrderInput: externalOrderInputSchema,
};

class IntegrationHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "IntegrationHttpError";
  }
}

class IntegrationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationUnavailableError";
  }
}

function requirePositiveBranchId(branchId: number) {
  if (!Number.isInteger(branchId) || branchId < 1)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "رقم الفرع غير صالح.",
    });
  return branchId;
}

function requireDatabase() {
  return getDb().then(db => {
    if (!db)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "قاعدة البيانات غير متاحة.",
      });
    return db;
  });
}

/** Stable, readable, numeric display code; never exposes the random temporary insert code. */
export function formatExternalOrderCode(
  createdAt: Date,
  orderId: number,
  prefix = "S"
) {
  const date = createdAt.toISOString().slice(0, 10).replaceAll("-", "");
  if (!/^\d+$/.test(String(orderId)) || orderId < 1)
    throw new Error("Invalid order id for display code");
  return `${prefix}-${date}-${orderId}`;
}

export function hashIntegrationKey(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createIntegrationKey() {
  const secret = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    secret,
    tokenHash: hashIntegrationKey(secret),
    tokenPrefix: secret.slice(0, 16),
  };
}

export function verifyIntegrationKey(token: string, expectedHash: string) {
  const actual = Buffer.from(hashIntegrationKey(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function extractBearerToken(header: string | undefined) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

/**
 * Role checking intentionally prefers the new role field. The canManager fallback is
 * only for the pre-role schema currently in this checkout and is removed once the
 * parent migration supplies role/branchId on every session.
 */
export function canManageIntegration(
  actor: IntegrationManagementActor | null | undefined,
  branchId: number
) {
  if (!actor || actor.isActive === false) return false;
  if (actor.role === "system_admin" || actor.role === "developer") return true;
  if (actor.role === "branch_manager") return actor.branchId === branchId;
  if (actor.role) return false;
  return (
    actor.canManager === true &&
    (actor.branchId == null || actor.branchId === branchId)
  );
}

export function assertCanManageIntegration(
  actor: IntegrationManagementActor | null | undefined,
  branchId: number
) {
  requirePositiveBranchId(branchId);
  if (!canManageIntegration(actor, branchId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "إدارة التكامل متاحة لمدير النظام أو مدير الفرع فقط.",
    });
  }
}

function coreColumn(table: unknown, name: string, humanName = name): any {
  const column = (table as Record<string, unknown>)[name];
  if (!column)
    throw new IntegrationUnavailableError(
      `المخطط الأساسي لا يحتوي حقل التكامل المطلوب: ${humanName}.`
    );
  return column;
}

function optionalCoreColumn(table: unknown, name: string): any | undefined {
  return (table as Record<string, unknown>)[name];
}

function externalOrderConditions(
  branchId: number,
  externalOrderId: string,
  externalItemId?: string
) {
  const conditions = [
    eq(coreColumn(kitchenOrders, "branchId", "branchId"), branchId),
    eq(
      coreColumn(kitchenOrders, "externalOrderId", "externalOrderId"),
      externalOrderId
    ),
  ];
  if (externalItemId !== undefined)
    conditions.push(
      eq(
        coreColumn(kitchenOrders, "externalItemId", "externalItemId"),
        externalItemId
      )
    );
  return and(...conditions);
}

function keyRowsForBearer(db: any, token: string) {
  return db
    .select()
    .from(integrationApiKeys)
    .where(
      and(
        eq(integrationApiKeys.tokenHash, hashIntegrationKey(token)),
        isNull(integrationApiKeys.revokedAt)
      )
    )
    .limit(1);
}

export async function authenticateExternalKey(token: string) {
  if (!token || token.length > 160 || !token.startsWith(API_KEY_PREFIX))
    throw new IntegrationHttpError(401, "مفتاح التكامل غير صالح.");
  const db = await getDb();
  if (!db) throw new IntegrationHttpError(503, "قاعدة البيانات غير متاحة.");
  const [key] = await keyRowsForBearer(db, token);
  if (!key)
    throw new IntegrationHttpError(401, "مفتاح التكامل غير صالح أو ملغى.");
  return { keyId: key.id, branchId: key.branchId, label: key.label };
}

function temporaryOrderCode() {
  return `TMP-${randomBytes(12).toString("hex")}`.slice(0, 24);
}

function productBranchCondition(productId: number, branchId: number) {
  const branchColumn = optionalCoreColumn(products, "branchId");
  return branchColumn
    ? and(
        eq(products.id, productId),
        eq(branchColumn, branchId),
        eq(products.isActive, true)
      )
    : and(eq(products.id, productId), eq(products.isActive, true));
}

function ensureExternalCoreColumns() {
  coreColumn(kitchenOrders, "branchId", "branchId");
  coreColumn(kitchenOrders, "externalOrderId", "externalOrderId");
  coreColumn(kitchenOrders, "externalItemId", "externalItemId");
  coreColumn(kitchenOrders, "orderSource", "orderSource");
  coreColumn(kitchenOrders, "syncStatus", "syncStatus");
  coreColumn(kitchenOrderItems, "graceMinutes", "items.graceMinutes");
  coreColumn(products, "branchId", "products.branchId");
  coreColumn(products, "graceMinutes", "products.graceMinutes");
}

async function insertOutboxRow(
  executor: any,
  input: {
    branchId: number;
    orderId?: number;
    eventType: string;
    payload: unknown;
  }
) {
  await executor.insert(integrationOutbox).values({
    branchId: input.branchId,
    orderId: input.orderId ?? null,
    eventType: input.eventType,
    payload: JSON.stringify(input.payload),
    status: "pending",
    attempts: 0,
  });
}

/** Parent core transitions may call this after their transaction, or insert directly in their transaction. */
export async function enqueueIntegrationEvent(input: {
  branchId: number;
  orderId?: number;
  eventType: string;
  payload: unknown;
}) {
  requirePositiveBranchId(input.branchId);
  const db = await requireDatabase();
  await insertOutboxRow(db, input);
  return { queued: true } as const;
}

export async function createExternalOrders(
  branchId: number,
  input: ExternalOrderInput
): Promise<ExternalOrderResult> {
  requirePositiveBranchId(branchId);
  const parsed = externalOrderInputSchema.parse(input);
  const uniqueExternalItems = new Set<string>();
  for (const item of parsed.items) {
    if (uniqueExternalItems.has(item.externalItemId))
      throw new IntegrationHttpError(
        409,
        "لا يجوز تكرار externalItemId داخل الطلب نفسه."
      );
    uniqueExternalItems.add(item.externalItemId);
  }
  ensureExternalCoreColumns();
  const db = await getDb();
  if (!db) throw new IntegrationHttpError(503, "قاعدة البيانات غير متاحة.");
  const [branch] = await db
    .select({ id: branches.id, ordersEnabled: branches.ordersEnabled })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch) throw new IntegrationHttpError(404, "الفرع غير موجود.");
  if (!branch.ordersEnabled)
    throw new IntegrationHttpError(409, "استقبال الطلبات متوقف لهذا الفرع.");

  return db.transaction(async (tx: any) => {
    const results: ExternalOrderResult["orders"] = [];
    for (const item of parsed.items) {
      const [existing] = await tx
        .select()
        .from(kitchenOrders)
        .where(
          externalOrderConditions(
            branchId,
            parsed.externalOrderId,
            item.externalItemId
          )
        )
        .limit(1);
      if (existing) {
        const [persistedItem] = await tx
          .select({
            productId: kitchenOrderItems.productId,
            quantity: kitchenOrderItems.quantity,
          })
          .from(kitchenOrderItems)
          .where(eq(kitchenOrderItems.orderId, existing.id))
          .limit(1);
        if (!persistedItem)
          throw new IntegrationHttpError(
            409,
            "التذكرة الموجودة ناقصة البنود؛ راجع سجلها قبل إعادة المحاولة."
          );
        results.push({
          id: Number(existing.id),
          orderCode: String(existing.orderCode),
          externalOrderId: parsed.externalOrderId,
          externalItemId: item.externalItemId,
          productId: Number(persistedItem.productId),
          quantity: Number(persistedItem.quantity),
          status: String(existing.status),
          created: false,
        });
        continue;
      }

      const foundProducts = await tx
        .select()
        .from(products)
        .where(productBranchCondition(item.productId, branchId))
        .limit(1);
      const product = foundProducts[0] as Record<string, unknown> | undefined;
      if (!product || product.isActive !== true)
        throw new IntegrationHttpError(
          409,
          `الصنف ${item.productId} غير نشط أو غير موجود في الفرع.`
        );
      const createdAt = new Date();
      const graceMinutes = Number(product.graceMinutes ?? 5);
      const orderValues: Record<string, unknown> = {
        orderCode: temporaryOrderCode(),
        status: "new",
        notes: parsed.notes || null,
        createdAt,
        branchId,
        orderSource: "external",
        createdById: null,
        createdByName: EXTERNAL_ACTOR_NAME,
        externalOrderId: parsed.externalOrderId,
        externalItemId: item.externalItemId,
        syncStatus: "pending",
        extensionMinutes: 0,
        originalDueAt: null,
        effectiveDueAt: null,
        everOverdue: false,
      };
      const inserted = await tx
        .insert(kitchenOrders)
        .values(orderValues as any);
      const orderId = Number(inserted[0].insertId);
      const orderCode = formatExternalOrderCode(createdAt, orderId);
      await tx
        .update(kitchenOrders)
        .set({ orderCode } as any)
        .where(eq(kitchenOrders.id, orderId));
      await tx.insert(kitchenOrderItems).values({
        orderId,
        productId: item.productId,
        productName: String(product.name),
        quantity: item.quantity,
        prepMinutes: Number(product.prepMinutes),
        graceMinutes,
        hasTimer: product.hasTimer !== false,
      } as any);
      await tx.insert(kitchenOrderEvents).values({
        orderId,
        status: "new",
        actor: EXTERNAL_ACTOR_NAME,
        createdAt,
        detail: "أُنشئت التذكرة من التكامل الخارجي",
      } as any);
      await insertOutboxRow(tx, {
        branchId,
        orderId,
        eventType: "order.created",
        payload: {
          orderId,
          orderCode,
          externalOrderId: parsed.externalOrderId,
          externalItemId: item.externalItemId,
          status: "new",
        },
      });
      results.push({
        id: orderId,
        orderCode,
        externalOrderId: parsed.externalOrderId,
        externalItemId: item.externalItemId,
        productId: item.productId,
        quantity: item.quantity,
        status: "new",
        created: true,
      });
    }
    return { orders: results };
  });
}

export async function readExternalOrderStatus(
  branchId: number,
  externalOrderId: string
) {
  requirePositiveBranchId(branchId);
  if (!externalOrderId.trim() || externalOrderId.length > 160)
    throw new IntegrationHttpError(400, "externalOrderId غير صالح.");
  const db = await getDb();
  if (!db) throw new IntegrationHttpError(503, "قاعدة البيانات غير متاحة.");
  ensureExternalCoreColumns();
  const rows = await db
    .select()
    .from(kitchenOrders)
    .where(externalOrderConditions(branchId, externalOrderId.trim()));
  return {
    externalOrderId: externalOrderId.trim(),
    orders: (rows as Array<Record<string, unknown>>).map(row => ({
      id: Number(row.id),
      orderCode: String(row.orderCode),
      externalItemId: String(row.externalItemId),
      status: String(row.status),
      syncStatus: String(row.syncStatus),
      readyAt: row.readyAt ?? null,
      receivedAt: row.receivedAt ?? null,
    })),
  };
}

function isPrivateIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return true;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function isPrivateOrLocalAddress(address: string) {
  const normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const family = isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family === 6) {
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd")
    )
      return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIpv4(mapped[1]) : false;
  }
  return false;
}

export async function validateWebhookUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "عنوان Webhook غير صالح.",
    });
  }
  if (parsed.protocol !== "https:")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "لا يُقبل Webhook إلا عبر HTTPS.",
    });
  if (parsed.username || parsed.password)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "لا تضع بيانات اعتماد داخل عنوان Webhook.",
    });
  if (parsed.port && parsed.port !== "443")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "يجب استخدام منفذ HTTPS القياسي.",
    });
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname.endsWith(".localhost") ||
    parsed.hostname.endsWith(".local") ||
    isPrivateOrLocalAddress(parsed.hostname)
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "العناوين المحلية والخاصة غير مسموحة.",
    });
  }
  try {
    const resolved = await lookup(parsed.hostname, {
      all: true,
      verbatim: true,
    });
    if (
      !resolved.length ||
      resolved.some(entry => isPrivateOrLocalAddress(entry.address))
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "يجب أن يحل Webhook إلى عنوان عام فقط.",
      });
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "تعذر التحقق من عنوان Webhook العام.",
    });
  }
  return parsed;
}

export function assertNoWebhookCredentials(input: Record<string, unknown>) {
  const credentialFields = [
    "secret",
    "token",
    "apiKey",
    "authToken",
    "authorization",
    "credentials",
  ];
  if (
    credentialFields.some(
      field =>
        input[field] !== undefined &&
        input[field] !== null &&
        input[field] !== ""
    )
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "لا تُحفظ بيانات اعتماد المزود قبل توفير عقد التكامل الموثق.",
    });
  }
}

function safeConfig(
  row: typeof integrationWebhookConfigs.$inferSelect | undefined
) {
  return {
    branchId: row?.branchId ?? null,
    webhookUrl: row?.webhookUrl ?? null,
    enabled: Boolean(row?.enabled),
    providerConfigured: Boolean(row?.providerConfigured),
    outboundEnabled: Boolean(
      row?.enabled && row?.providerConfigured && row?.webhookUrl
    ),
    status:
      row?.enabled && row?.providerConfigured
        ? "ready"
        : "disabled_pending_provider_docs",
    message: PROVIDER_NOT_CONFIGURED_MESSAGE,
    updatedAt: row?.updatedAt ?? null,
  } as const;
}

export async function getIntegrationConfig(branchId: number) {
  requirePositiveBranchId(branchId);
  const db = await requireDatabase();
  const [row] = await db
    .select()
    .from(integrationWebhookConfigs)
    .where(eq(integrationWebhookConfigs.branchId, branchId))
    .limit(1);
  return safeConfig(row);
}

export async function saveIntegrationConfig(input: {
  branchId: number;
  webhookUrl?: string | null;
  url?: string | null;
  enabled?: boolean;
  [key: string]: unknown;
}) {
  requirePositiveBranchId(input.branchId);
  assertNoWebhookCredentials(input);
  if (input.enabled === true)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: PROVIDER_NOT_CONFIGURED_MESSAGE,
    });
  const rawUrl = input.webhookUrl ?? input.url ?? null;
  if (rawUrl) await validateWebhookUrl(rawUrl);
  const db = await requireDatabase();
  await db
    .insert(integrationWebhookConfigs)
    .values({
      branchId: input.branchId,
      webhookUrl: rawUrl,
      enabled: Boolean(input.enabled),
      providerConfigured: false,
    })
    .onDuplicateKeyUpdate({
      set: { webhookUrl: rawUrl, enabled: false, providerConfigured: false },
    });
  return getIntegrationConfig(input.branchId);
}

export async function createManagedIntegrationKey(input: {
  branchId: number;
  label: string;
  actor: IntegrationManagementActor;
}) {
  requirePositiveBranchId(input.branchId);
  assertCanManageIntegration(input.actor, input.branchId);
  const label = input.label.trim();
  if (!label || label.length > 120)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "اسم المفتاح مطلوب وبحد أقصى 120 حرفًا.",
    });
  const db = await requireDatabase();
  const generated = createIntegrationKey();
  const actorName =
    input.actor.displayName ?? input.actor.name ?? "مدير التكامل";
  return db.transaction(async (tx: any) => {
    const inserted = await tx
      .insert(integrationApiKeys)
      .values({
        branchId: input.branchId,
        label,
        tokenHash: generated.tokenHash,
        tokenPrefix: generated.tokenPrefix,
        createdById: input.actor.id,
        createdByName: actorName,
      });
    const keyId = Number(inserted[0].insertId);
    await tx
      .insert(integrationKeyAudit)
      .values({
        branchId: input.branchId,
        keyId,
        action: "created",
        actorId: input.actor.id,
        actorName,
        detail: "تم إنشاء مفتاح؛ سيظهر السر مرة واحدة فقط.",
      });
    return {
      id: keyId,
      branchId: input.branchId,
      label,
      tokenPrefix: generated.tokenPrefix,
      key: generated.secret,
      createdAt: new Date(),
      shownOnce: true as const,
    };
  });
}

export async function listManagedIntegrationKeys(
  branchId: number,
  actor: IntegrationManagementActor
) {
  assertCanManageIntegration(actor, branchId);
  const db = await requireDatabase();
  return db
    .select({
      id: integrationApiKeys.id,
      branchId: integrationApiKeys.branchId,
      label: integrationApiKeys.label,
      tokenPrefix: integrationApiKeys.tokenPrefix,
      createdAt: integrationApiKeys.createdAt,
      revokedAt: integrationApiKeys.revokedAt,
    })
    .from(integrationApiKeys)
    .where(eq(integrationApiKeys.branchId, branchId))
    .orderBy(desc(integrationApiKeys.createdAt), desc(integrationApiKeys.id));
}

export async function revokeManagedIntegrationKey(input: {
  branchId: number;
  keyId: number;
  actor: IntegrationManagementActor;
}) {
  assertCanManageIntegration(input.actor, input.branchId);
  const db = await requireDatabase();
  return db.transaction(async (tx: any) => {
    const [key] = await tx
      .select()
      .from(integrationApiKeys)
      .where(
        and(
          eq(integrationApiKeys.id, input.keyId),
          eq(integrationApiKeys.branchId, input.branchId)
        )
      )
      .limit(1);
    if (!key)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "مفتاح التكامل غير موجود في هذا الفرع.",
      });
    if (!key.revokedAt) {
      const now = new Date();
      const actorName =
        input.actor.displayName ?? input.actor.name ?? "مدير التكامل";
      await tx
        .update(integrationApiKeys)
        .set({
          revokedAt: now,
          revokedById: input.actor.id,
          revokedByName: actorName,
        })
        .where(eq(integrationApiKeys.id, input.keyId));
      await tx
        .insert(integrationKeyAudit)
        .values({
          branchId: input.branchId,
          keyId: input.keyId,
          action: "revoked",
          actorId: input.actor.id,
          actorName,
          detail: "تم إلغاء المفتاح.",
        });
    }
    return { success: true as const, alreadyRevoked: Boolean(key.revokedAt) };
  });
}

export async function listIntegrationAttempts(input: {
  branchId: number;
  limit: number;
  offset: number;
  actor: IntegrationManagementActor;
}) {
  assertCanManageIntegration(input.actor, input.branchId);
  const db = await requireDatabase();
  const rows = await db
    .select()
    .from(integrationAttempts)
    .where(eq(integrationAttempts.branchId, input.branchId))
    .orderBy(
      desc(integrationAttempts.attemptedAt),
      desc(integrationAttempts.id)
    )
    .limit(input.limit)
    .offset(input.offset);
  return rows;
}

export async function flushIntegrationOutbox(input: {
  branchId?: number;
  limit: number;
  actor: IntegrationManagementActor;
}) {
  if (input.branchId !== undefined)
    assertCanManageIntegration(input.actor, input.branchId);
  else if (input.actor.role !== "system_admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "تفريغ Outbox لكل الفروع لمدير النظام فقط.",
    });
  const db = await requireDatabase();
  const pendingConditions = [
    eq(integrationOutbox.status, "pending"),
    or(
      isNull(integrationOutbox.nextAttemptAt),
      lte(integrationOutbox.nextAttemptAt, new Date())
    ),
  ];
  if (input.branchId !== undefined)
    pendingConditions.push(eq(integrationOutbox.branchId, input.branchId));
  const pending = await db
    .select({ id: integrationOutbox.id, branchId: integrationOutbox.branchId })
    .from(integrationOutbox)
    .where(and(...pendingConditions))
    .orderBy(asc(integrationOutbox.id))
    .limit(input.limit);
  const configRows =
    input.branchId === undefined
      ? []
      : await db
          .select()
          .from(integrationWebhookConfigs)
          .where(eq(integrationWebhookConfigs.branchId, input.branchId))
          .limit(1);
  const config = configRows[0];
  if (!config?.enabled || !config.providerConfigured || !config.webhookUrl) {
    return {
      attempted: 0,
      skipped: 0,
      pending: pending.length,
      outboundEnabled: false,
      message: PROVIDER_NOT_CONFIGURED_MESSAGE,
    } as const;
  }
  // Deliberately no provider request: UNIFYERP's endpoint/authentication contract is not supplied.
  return {
    attempted: 0,
    skipped: 0,
    pending: pending.length,
    outboundEnabled: false,
    message: PROVIDER_NOT_CONFIGURED_MESSAGE,
  } as const;
}

async function externalAuth(req: Request) {
  const token = extractBearerToken(req.header("authorization"));
  if (!token)
    throw new IntegrationHttpError(
      401,
      "يلزم Authorization: Bearer <integration-key>. "
    );
  return authenticateExternalKey(token);
}

function sendIntegrationError(res: Response, error: unknown) {
  if (error instanceof IntegrationHttpError)
    return res.status(error.status).json({ error: error.message });
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: "صيغة الطلب غير صالحة.", details: error.flatten() });
  if (error instanceof IntegrationUnavailableError)
    return res
      .status(503)
      .json({
        error: "التكامل غير متاح حتى تطبيق هجرة المخطط الأساسية.",
        detail: error.message,
      });
  console.error("[Integration] request failed; no payload or key logged");
  return res.status(500).json({ error: "تعذر معالجة طلب التكامل." });
}

export function registerIntegrationRoutes(app: Express) {
  app.post("/api/integration/orders", async (req, res) => {
    try {
      const auth = await externalAuth(req);
      const input = externalOrderInputSchema.parse(req.body);
      const result = await createExternalOrders(auth.branchId, input);
      return res
        .status(result.orders.some(order => order.created) ? 201 : 200)
        .json(result);
    } catch (error) {
      return sendIntegrationError(res, error);
    }
  });
  app.get(
    "/api/integration/orders/:externalOrderId/status",
    async (req, res) => {
      try {
        const auth = await externalAuth(req);
        const result = await readExternalOrderStatus(
          auth.branchId,
          req.params.externalOrderId
        );
        return res.status(200).json(result);
      } catch (error) {
        return sendIntegrationError(res, error);
      }
    }
  );
}

const branchInput = z.object({ branchId: z.number().int().positive() });
const saveConfigInput = z
  .object({
    branchId: z.number().int().positive(),
    webhookUrl: z.string().trim().max(2048).nullable().optional(),
    url: z.string().trim().max(2048).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();
const actorFromContext = (staffUser: unknown) =>
  staffUser as IntegrationManagementActor;

export const integrationRouter = router({
  config: managerProcedure.input(branchInput).query(({ ctx, input }) => {
    assertCanManageIntegration(actorFromContext(ctx.staffUser), input.branchId);
    return getIntegrationConfig(input.branchId);
  }),
  save: managerProcedure.input(saveConfigInput).mutation(({ ctx, input }) => {
    assertCanManageIntegration(actorFromContext(ctx.staffUser), input.branchId);
    return saveIntegrationConfig(input);
  }),
  createKey: managerProcedure
    .input(
      z.object({
        branchId: z.number().int().positive(),
        label: z.string().trim().min(1).max(120),
      })
    )
    .mutation(({ ctx, input }) =>
      createManagedIntegrationKey({
        ...input,
        actor: actorFromContext(ctx.staffUser),
      })
    ),
  listKeys: managerProcedure
    .input(branchInput)
    .query(({ ctx, input }) =>
      listManagedIntegrationKeys(
        input.branchId,
        actorFromContext(ctx.staffUser)
      )
    ),
  revokeKey: managerProcedure
    .input(
      z.object({
        branchId: z.number().int().positive(),
        keyId: z.number().int().positive(),
      })
    )
    .mutation(({ ctx, input }) =>
      revokeManagedIntegrationKey({
        ...input,
        actor: actorFromContext(ctx.staffUser),
      })
    ),
  attempts: managerProcedure
    .input(
      z.object({
        branchId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).max(100000).default(0),
      })
    )
    .query(({ ctx, input }) =>
      listIntegrationAttempts({
        ...input,
        actor: actorFromContext(ctx.staffUser),
      })
    ),
  flush: managerProcedure
    .input(
      z.object({
        branchId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .mutation(({ ctx, input }) =>
      flushIntegrationOutbox({
        ...input,
        actor: actorFromContext(ctx.staffUser),
      })
    ),
});
