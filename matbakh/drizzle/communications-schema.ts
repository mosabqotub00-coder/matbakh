import {
  customType,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const audioBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "longblob",
});

export const broadcasts = mysqlTable(
  "broadcasts",
  {
    id: int("id").autoincrement().primaryKey(),
    branchId: int("branch_id").notNull(),
    senderId: int("sender_id").notNull(),
    senderName: varchar("sender_name", { length: 120 }).notNull(),
    targetSection: mysqlEnum("target_section", [
      "station",
      "kitchen",
    ]).notNull(),
    orderId: int("order_id"),
    title: varchar("title", { length: 160 }).notNull(),
    status: mysqlEnum("status", ["live", "ended", "interrupted"])
      .default("live")
      .notNull(),
    sampleRate: int("sample_rate").default(16000).notNull(),
    totalBytes: int("total_bytes").default(0).notNull(),
    totalChunks: int("total_chunks").default(0).notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastChunkAt: timestamp("last_chunk_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
  },
  table => ({
    branchState: index("broadcast_branch_state_idx").on(
      table.branchId,
      table.status
    ),
    orderIdx: index("broadcast_order_idx").on(table.orderId),
  })
);

export const broadcastChunks = mysqlTable(
  "broadcast_chunks",
  {
    id: int("id").autoincrement().primaryKey(),
    broadcastId: int("broadcast_id").notNull(),
    sequence: int("sequence").notNull(),
    data: audioBlob("data").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    uniqueSequence: uniqueIndex("broadcast_chunk_sequence_uq").on(
      table.broadcastId,
      table.sequence
    ),
  })
);

export const broadcastListens = mysqlTable(
  "broadcast_listens",
  {
    id: int("id").autoincrement().primaryKey(),
    broadcastId: int("broadcast_id").notNull(),
    userId: int("user_id").notNull(),
    listenedAt: timestamp("listened_at").defaultNow().notNull(),
  },
  table => ({
    uniqueListen: uniqueIndex("broadcast_listen_user_uq").on(
      table.broadcastId,
      table.userId
    ),
  })
);
