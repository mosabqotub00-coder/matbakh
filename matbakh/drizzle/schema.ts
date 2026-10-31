import { boolean, customType, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const longBlob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "longblob" });

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const branches = mysqlTable("branches", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  city: varchar("city", { length: 120 }).notNull(),
  ordersEnabled: boolean("ordersEnabled").default(true).notNull(),
  isLegacy: boolean("isLegacy").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ nameCityUnique: uniqueIndex("branches_name_city_uq").on(table.name, table.city) }));

export const dataMigrationJournal = mysqlTable("data_migration_journal", {
  marker: varchar("marker", { length: 120 }).primaryKey(),
  appliedAt: timestamp("applied_at").defaultNow().notNull(),
  details: text("details"),
});

export const staffUsers = mysqlTable("staff_users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 64 }).notNull(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  passwordHash: varchar("password_hash", { length: 180 }).notNull(),
  role: mysqlEnum("role", ["developer", "system_admin", "branch_manager", "kitchen_manager", "shift_manager", "station", "kitchen"]).default("station").notNull(),
  branchId: int("branch_id"),
  usualShift: mysqlEnum("usual_shift", ["morning", "evening", "flexible"]),
  // Retained during and after v2 migration for compatibility with old sessions/UI.
  canStation: boolean("can_station").default(false).notNull(),
  canKitchen: boolean("can_kitchen").default(false).notNull(),
  canManager: boolean("can_manager").default(false).notNull(),
  canManageUsers: boolean("can_manage_users").default(false).notNull(),
  canBroadcast: boolean("can_broadcast").default(false).notNull(),
  canExtend: boolean("can_extend").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  mustChangePassword: boolean("must_change_password").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({ usernameUnique: uniqueIndex("staff_users_username_uq").on(table.username), branchRoleIdx: index("staff_users_branch_role_idx").on(table.branchId, table.role) }));

export const staffSessions = mysqlTable("staff_sessions", {
  id: int("id").autoincrement().primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  userId: int("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, table => ({ tokenUnique: uniqueIndex("staff_sessions_token_uq").on(table.tokenHash), userExpiry: index("staff_sessions_user_expiry_idx").on(table.userId, table.expiresAt) }));

export const products = mysqlTable("products", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branchId"),
  name: varchar("name", { length: 120 }).notNull(),
  category: varchar("category", { length: 80 }).default("دجاج").notNull(),
  prepMinutes: int("prepMinutes").default(10).notNull(),
  graceMinutes: int("graceMinutes").default(5).notNull(),
  hasTimer: boolean("hasTimer").default(true).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ branchActiveIdx: index("products_branch_active_idx").on(table.branchId, table.isActive), branchNameUnique: uniqueIndex("products_branch_name_uq").on(table.branchId, table.name) }));

export const kitchenOrders = mysqlTable("kitchenOrders", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branchId"),
  orderCode: varchar("orderCode", { length: 24 }).notNull().unique(),
  status: mysqlEnum("status", ["new", "preparing", "ready", "received"]).default("new").notNull(),
  orderSource: mysqlEnum("orderSource", ["internal", "kitchen_manager", "external"]).default("internal").notNull(),
  createdById: int("createdById"),
  createdByName: varchar("createdByName", { length: 120 }),
  notes: text("notes"),
  voiceData: longBlob("voiceData"),
  voiceType: varchar("voiceType", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acceptedAt: timestamp("acceptedAt"),
  acceptedById: int("acceptedById"),
  readyAt: timestamp("readyAt"),
  receivedAt: timestamp("receivedAt"),
  receivedById: int("receivedById"),
  receivedByName: varchar("receivedByName", { length: 120 }),
  extensionMinutes: int("extensionMinutes").default(0).notNull(),
  originalDueAt: timestamp("originalDueAt"),
  effectiveDueAt: timestamp("effectiveDueAt"),
  everOverdue: boolean("everOverdue").default(false).notNull(),
  externalOrderId: varchar("externalOrderId", { length: 160 }),
  externalItemId: varchar("externalItemId", { length: 160 }),
  syncStatus: mysqlEnum("syncStatus", ["pending", "synced", "error", "not_required"]).default("not_required").notNull(),
}, table => ({ branchStatusIdx: index("orders_branch_status_idx").on(table.branchId, table.status), branchCreatedIdx: index("orders_branch_created_idx").on(table.branchId, table.createdAt), externalItemUnique: uniqueIndex("orders_external_item_uq").on(table.branchId, table.externalOrderId, table.externalItemId) }));

export const kitchenOrderItems = mysqlTable("kitchenOrderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  productId: int("productId").notNull(),
  productName: varchar("productName", { length: 120 }).notNull(),
  quantity: int("quantity").notNull(),
  prepMinutes: int("prepMinutes").notNull(),
  graceMinutes: int("graceMinutes").default(5).notNull(),
  hasTimer: boolean("hasTimer").default(true).notNull(),
});

export const kitchenOrderEvents = mysqlTable("kitchenOrderEvents", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  status: mysqlEnum("status", ["new", "preparing", "ready", "received"]).notNull(),
  kind: mysqlEnum("kind", ["created", "accepted", "ready", "received", "extended"]).default("created").notNull(),
  actorId: int("actorId"),
  actor: varchar("actor", { length: 120 }).default("موظف الوردية").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  previousDueAt: timestamp("previousDueAt"),
  newDueAt: timestamp("newDueAt"),
  addedMinutes: int("addedMinutes"),
  reason: varchar("reason", { length: 500 }),
  detail: varchar("detail", { length: 255 }),
});

export const developerErrors = mysqlTable("developer_errors", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id"),
  userId: int("user_id"),
  severity: mysqlEnum("severity", ["info", "warning", "error", "critical"]).default("error").notNull(),
  source: varchar("source", { length: 80 }).notNull(),
  message: text("message").notNull(),
  route: varchar("route", { length: 255 }),
  details: text("details"),
  status: mysqlEnum("status", ["new", "investigating", "resolved", "ignored"]).default("new").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedById: int("resolved_by_id"),
}, table => ({ branchCreatedIdx: index("developer_errors_branch_created_idx").on(table.branchId, table.createdAt), statusIdx: index("developer_errors_status_idx").on(table.status) }));

export const staffFeedback = mysqlTable("staff_feedback", {
  id: int("id").autoincrement().primaryKey(),
  branchId: int("branch_id"),
  userId: int("user_id").notNull(),
  orderId: int("order_id"),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").notNull(),
  priority: mysqlEnum("priority", ["low", "normal", "high", "urgent"]).default("normal").notNull(),
  attachmentData: longBlob("attachment_data"),
  attachmentName: varchar("attachment_name", { length: 160 }),
  attachmentType: varchar("attachment_type", { length: 120 }),
  status: mysqlEnum("status", ["new", "investigating", "resolved", "closed"]).default("new").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  resolvedById: int("resolved_by_id"),
}, table => ({ branchCreatedIdx: index("staff_feedback_branch_created_idx").on(table.branchId, table.createdAt), statusIdx: index("staff_feedback_status_idx").on(table.status) }));

export const featureFlags = mysqlTable("feature_flags", {
  id: int("id").autoincrement().primaryKey(),
  featureKey: varchar("feature_key", { length: 120 }).notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  description: text("description"),
  target: mysqlEnum("target", ["developer", "branch", "all"]).default("developer").notNull(),
  branchId: int("branch_id"),
  enabled: boolean("enabled").default(false).notNull(),
  createdById: int("created_by_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({ featureTargetUnique: uniqueIndex("feature_flags_feature_target_uq").on(table.featureKey, table.target, table.branchId) }));

export const releaseManifests = mysqlTable("release_manifests", {
  id: int("id").autoincrement().primaryKey(),
  version: varchar("version", { length: 40 }).notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  notes: text("notes"),
  artifactName: varchar("artifact_name", { length: 160 }),
  artifactData: longBlob("artifact_data"),
  artifactSize: int("artifact_size"),
  status: mysqlEnum("status", ["uploaded", "testing", "approved", "deployed", "rolled_back"]).default("uploaded").notNull(),
  target: mysqlEnum("target", ["developer", "branch", "all"]).default("developer").notNull(),
  targetBranchId: int("target_branch_id"),
  createdById: int("created_by_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({ releaseVersionIdx: index("release_manifests_version_idx").on(table.version), releaseStatusIdx: index("release_manifests_status_idx").on(table.status) }));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Branch = typeof branches.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
export type StaffSession = typeof staffSessions.$inferSelect;
export type Product = typeof products.$inferSelect;
export type KitchenOrder = typeof kitchenOrders.$inferSelect;
export type KitchenOrderItem = typeof kitchenOrderItems.$inferSelect;
export type KitchenOrderEvent = typeof kitchenOrderEvents.$inferSelect;
export type DeveloperError = typeof developerErrors.$inferSelect;
export type StaffFeedback = typeof staffFeedback.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type ReleaseManifest = typeof releaseManifests.$inferSelect;

// These exports keep migration discovery centralized while the feature agents
// own their table definitions.
export * from "./notifications-schema";
export * from "./communications-schema";
export * from "./integration-schema";
export * from "./native-push-schema";
