import { boolean, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Integration persistence is deliberately separate from drizzle/schema.ts. The parent
 * agent exports this module from the schema aggregator after the core branch/order
 * migration is reviewed and applied.
 */

export const integrationApiKeys = mysqlTable("integration_api_keys", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  tokenPrefix: varchar("token_prefix", { length: 32 }).notNull(),
  createdById: int("created_by_id"),
  createdByName: varchar("created_by_name", { length: 120 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  revokedById: int("revoked_by_id"),
  revokedByName: varchar("revoked_by_name", { length: 120 }),
}, table => ({
  tokenHashUnique: uniqueIndex("integration_api_keys_token_hash_uq").on(table.tokenHash),
  branchCreated: index("integration_api_keys_branch_created_idx").on(table.branchId, table.createdAt),
}));

/** One outbound target per branch. Credentials are intentionally not stored. */
export const integrationWebhookConfigs = mysqlTable("integration_webhook_configs", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull(),
  webhookUrl: varchar("webhook_url", { length: 2048 }),
  enabled: boolean("enabled").default(false).notNull(),
  /** False until the provider's documented endpoint and authentication are supplied. */
  providerConfigured: boolean("provider_configured").default(false).notNull(),
  updatedById: int("updated_by_id"),
  updatedByName: varchar("updated_by_name", { length: 120 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  branchUnique: uniqueIndex("integration_webhook_configs_branch_uq").on(table.branchId),
}));

export const integrationOutbox = mysqlTable("integration_outbox", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull(),
  orderId: int("order_id"),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  payload: text("payload").notNull(),
  status: mysqlEnum("status", ["pending", "delivered", "failed", "skipped"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  nextAttemptAt: timestamp("next_attempt_at"),
  lastError: varchar("last_error", { length: 1000 }),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  pendingScan: index("integration_outbox_pending_scan_idx").on(table.status, table.nextAttemptAt, table.id),
  branchCreated: index("integration_outbox_branch_created_idx").on(table.branchId, table.createdAt),
  orderEvent: index("integration_outbox_order_event_idx").on(table.orderId, table.eventType),
}));

export const integrationAttempts = mysqlTable("integration_attempts", {
  id: int("id").autoincrement().primaryKey(),
  outboxId: int("outbox_id").notNull(),
  branchId: int("branch_id").notNull(),
  status: mysqlEnum("status", ["sent", "failed", "skipped"]).notNull(),
  responseStatus: int("response_status"),
  error: varchar("error", { length: 1000 }),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
  durationMs: int("duration_ms"),
}, table => ({
  outboxAttempted: index("integration_attempts_outbox_attempted_idx").on(table.outboxId, table.attemptedAt),
  branchAttempted: index("integration_attempts_branch_attempted_idx").on(table.branchId, table.attemptedAt),
}));

export const integrationKeyAudit = mysqlTable("integration_key_audit", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull(),
  keyId: int("key_id"),
  action: mysqlEnum("action", ["created", "revoked"]).notNull(),
  actorId: int("actor_id"),
  actorName: varchar("actor_name", { length: 120 }),
  detail: varchar("detail", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  branchCreated: index("integration_key_audit_branch_created_idx").on(table.branchId, table.createdAt),
}));

export type IntegrationApiKey = typeof integrationApiKeys.$inferSelect;
export type IntegrationWebhookConfig = typeof integrationWebhookConfigs.$inferSelect;
export type IntegrationOutboxRow = typeof integrationOutbox.$inferSelect;
export type IntegrationAttempt = typeof integrationAttempts.$inferSelect;
export type IntegrationKeyAudit = typeof integrationKeyAudit.$inferSelect;
