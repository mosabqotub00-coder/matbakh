import { index, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Android app installations bound to one live staff session for Expo push delivery. */
export const nativePushDevices = mysqlTable("native_push_devices", {
  id: int("id").autoincrement().primaryKey(),
  installationId: varchar("installation_id", { length: 64 }).notNull(),
  userId: int("user_id").notNull(),
  sessionHash: varchar("session_hash", { length: 64 }).notNull(),
  expoPushToken: varchar("expo_push_token", { length: 255 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull().default("android"),
  appVersion: varchar("app_version", { length: 32 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, table => ({
  installationUnique: uniqueIndex("native_push_installation_uq").on(table.installationId),
  userIdx: index("native_push_user_idx").on(table.userId),
  tokenIdx: index("native_push_token_idx").on(table.expoPushToken),
}));

export type NativePushDevice = typeof nativePushDevices.$inferSelect;
