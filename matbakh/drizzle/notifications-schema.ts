import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Private application settings. Values in this table are never returned by a
 * client procedure; VAPID private keys live here rather than in source or files.
 */
export const settings = mysqlTable("settings", {
  settingKey: varchar("setting_key", { length: 120 }).primaryKey(),
  settingValue: text("setting_value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id").notNull(),
  orderId: int("order_id"),
  type: varchar("type", { length: 48 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  targetSection: mysqlEnum("target_section", ["station", "kitchen", "all"]).default("all").notNull(),
  /** Optional exact role; normal business events use section audience rules. */
  targetRole: varchar("target_role", { length: 32 }),
  dedupeKey: varchar("dedupe_key", { length: 220 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({
  branchCreated: index("notification_branch_created_idx").on(table.branchId, table.createdAt),
  orderCreated: index("notification_order_created_idx").on(table.orderId, table.createdAt),
  dedupeUnique: uniqueIndex("notification_dedupe_uq").on(table.dedupeKey),
}));

export const notificationReads = mysqlTable("notification_reads", {
  id: int("id").autoincrement().primaryKey(),
  notificationId: int("notification_id").notNull(),
  userId: int("user_id").notNull(),
  readAt: timestamp("read_at").defaultNow().notNull(),
}, table => ({
  userNotification: uniqueIndex("notification_read_user_uq").on(table.notificationId, table.userId),
  userRead: index("notification_read_user_idx").on(table.userId, table.readAt),
}));

export const pushSubscriptions = mysqlTable("push_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  endpoint: varchar("endpoint", { length: 2048 }).notNull(),
  endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
  p256dh: varchar("p256dh", { length: 255 }).notNull(),
  auth: varchar("auth", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  endpointUnique: uniqueIndex("push_subscription_endpoint_hash_uq").on(table.endpointHash),
  userUpdated: index("push_subscription_user_updated_idx").on(table.userId, table.updatedAt),
}));

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type NotificationRead = typeof notificationReads.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type Setting = typeof settings.$inferSelect;
