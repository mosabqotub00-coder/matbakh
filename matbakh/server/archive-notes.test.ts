import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { StaffSessionUser } from "./staff";
import {
  kitchenOrderEvents,
  kitchenOrderItems,
  kitchenOrders,
} from "../drizzle/schema";
import { getDb } from "./db";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const mockState = vi.hoisted(() => ({
  resolvedBranchId: undefined as number | null | undefined,
}));

vi.mock("./db", () => ({ getDb: vi.fn() }));

vi.mock("./branches", async importOriginal => {
  const actual = await importOriginal<typeof import("./branches")>();
  return {
    ...actual,
    resolveBranchId: vi.fn((actor, requestedBranchId) => {
      const branchId = actual.resolveBranchId(actor, requestedBranchId);
      mockState.resolvedBranchId = branchId;
      return branchId;
    }),
  };
});

vi.mock("./staff", async importOriginal => {
  const actual = await importOriginal<typeof import("./staff")>();
  return {
    ...actual,
    listStaffAccounts: vi.fn(() => ({ users: [], total: 0, activeCount: 0 })),
  };
});

import { appRouter } from "./routers";
import { listHistory } from "./kitchen";

const notes = "ملاحظة كاملة حرفيًا\nلا تُقص ولا تُحوّل";
const voiceBytes = Buffer.from("branch-one-voice");
const createdAt = new Date("2026-10-27T12:00:00Z");

const branchOneOrder = {
  id: 42,
  branchId: 1,
  orderCode: "S-20261027-42",
  status: "received",
  orderSource: "internal",
  createdById: 7,
  createdByName: "موظف السخان",
  notes,
  voiceData: voiceBytes,
  voiceType: "audio/webm",
  createdAt,
  acceptedAt: new Date("2026-10-27T12:03:00Z"),
  acceptedById: 9,
  readyAt: new Date("2026-10-27T12:10:00Z"),
  receivedAt: new Date("2026-10-27T12:12:00Z"),
  receivedById: 7,
  receivedByName: "موظف السخان",
  extensionMinutes: 8,
  originalDueAt: new Date("2026-10-27T12:08:00Z"),
  effectiveDueAt: new Date("2026-10-27T12:16:00Z"),
  everOverdue: false,
  externalOrderId: null,
  externalItemId: null,
  syncStatus: "not_required",
  voiceAvailable: 1,
};

const branchTwoOrder = {
  ...branchOneOrder,
  id: 99,
  branchId: 2,
  orderCode: "S-20261027-99",
  notes: "ملاحظة فرع آخر",
  voiceData: Buffer.from("branch-two-private-voice"),
};

const items = [
  {
    id: 1,
    orderId: 42,
    productId: 5,
    productName: "وجبة الفرع الأول",
    quantity: 2,
    prepMinutes: 10,
    graceMinutes: 5,
  },
];

const events = [
  {
    id: 1,
    orderId: 42,
    status: "new",
    kind: "created",
    actorId: 7,
    actor: "موظف السخان",
    createdAt: new Date("2026-10-27T12:00:00Z"),
    previousDueAt: null,
    newDueAt: null,
    addedMinutes: null,
    reason: null,
    detail: "أُرسل الطلب",
  },
  {
    id: 2,
    orderId: 42,
    status: "received",
    kind: "received",
    actorId: 7,
    actor: "موظف السخان",
    createdAt: new Date("2026-10-27T12:12:00Z"),
    previousDueAt: null,
    newDueAt: null,
    addedMinutes: null,
    reason: null,
    detail: "تم الاستلام",
  },
  {
    id: 3,
    orderId: 42,
    status: "received",
    kind: "extended",
    actorId: 9,
    actor: "مدير المطبخ",
    createdAt: new Date("2026-10-27T12:13:00Z"),
    previousDueAt: new Date("2026-10-27T12:08:00Z"),
    newDueAt: new Date("2026-10-27T12:16:00Z"),
    addedMinutes: 8,
    reason: "ازدحام مفاجئ في خط التحضير",
    detail: "تمديد 8 دقيقة",
  },
];

function staffUser(
  overrides: Partial<StaffSessionUser> = {}
): StaffSessionUser {
  return {
    id: 7,
    username: "station01",
    displayName: "موظف السخان",
    name: "موظف السخان",
    email: null,
    role: "station",
    branchId: 1,
    canStation: true,
    canKitchen: false,
    canManager: false,
    canManageUsers: false,
    canBroadcast: false,
    canExtend: false,
    isActive: true,
    mustChangePassword: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function callerFor(staffUserValue: StaffSessionUser | null) {
  const context: TrpcContext = {
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    staffUser: staffUserValue,
    staffSessionHash: "test-session-hash",
  };
  return appRouter.createCaller(context);
}

function installMockDb() {
  const orderRows = [branchOneOrder, branchTwoOrder];
  const db = {
    select(selection?: Record<string, unknown>) {
      let table: unknown;
      let orderIdFilter: number | undefined;
      let branchIdFilter: number | undefined;
      const builder: any = {
        from(value: unknown) {
          table = value;
          return builder;
        },
        where(condition: SQL) {
          const query = new MySqlDialect().sqlToQuery(condition);
          const equalityValue = (column: string) => {
            const position = query.sql.indexOf(`\`${column}\` = ?`);
            if (position < 0) return undefined;
            const parameterIndex = (
              query.sql.slice(0, position).match(/\?/g) ?? []
            ).length;
            return Number(query.params[parameterIndex]);
          };
          orderIdFilter = equalityValue(kitchenOrders.id.name);
          branchIdFilter = equalityValue(kitchenOrders.branchId.name);
          if (
            selection &&
            "voiceData" in selection &&
            mockState.resolvedBranchId != null
          ) {
            expect(branchIdFilter).toBe(mockState.resolvedBranchId);
          }
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        offset() {
          return builder;
        },
        then(
          resolve: (rows: unknown[]) => unknown,
          reject: (error: unknown) => unknown
        ) {
          const visibleOrders = orderRows.filter(
            order =>
              (branchIdFilter == null || order.branchId === branchIdFilter) &&
              (orderIdFilter == null || order.id === orderIdFilter)
          );
          let rows: unknown[] = [];
          if (table === kitchenOrders && selection && "total" in selection) {
            rows = [{ total: visibleOrders.length }];
          } else if (
            table === kitchenOrders &&
            selection &&
            "voiceData" in selection
          ) {
            rows = visibleOrders.map(order => ({
              voiceData: order.voiceData,
              voiceType: order.voiceType,
            }));
          } else if (table === kitchenOrders) {
            rows = visibleOrders;
          } else if (table === kitchenOrderItems) {
            const visibleIds = new Set(visibleOrders.map(order => order.id));
            rows = items.filter(item => visibleIds.has(item.orderId));
          } else if (table === kitchenOrderEvents) {
            const visibleIds = new Set(visibleOrders.map(order => order.id));
            rows = events.filter(event => visibleIds.has(event.orderId));
          }
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  vi.mocked(getDb).mockResolvedValue(
    db as unknown as Awaited<ReturnType<typeof getDb>>
  );
  return db;
}

beforeEach(() => {
  mockState.resolvedBranchId = undefined;
  vi.clearAllMocks();
  installMockDb();
});

describe("archive notes, voice metadata, and branch isolation", () => {
  it("history keeps the literal notes, voiceAvailable, items, and extended reason", async () => {
    const result = await listHistory(staffUser(), {
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.orders[0]).toMatchObject({
      id: 42,
      notes,
      voiceAvailable: true,
    });
    expect(result.orders[0].notes).toBe(notes);
    expect(result.orders[0].items).toEqual(items);
    expect(result.orders[0].events).toHaveLength(3);
    expect(result.orders[0].events[1]).toMatchObject({ kind: "received" });
    expect(result.orders[0].events[2]).toMatchObject({
      kind: "extended",
      reason: "ازدحام مفاجئ في خط التحضير",
      addedMinutes: 8,
    });
  });

  it("allows a station account to read same-branch audio as base64 and type only", async () => {
    const result = await callerFor(staffUser()).orders.voiceNote({
      orderId: 42,
    });

    expect(result).toEqual({
      data: voiceBytes.toString("base64"),
      type: "audio/webm",
    });
    expect(result).not.toHaveProperty("notes");
    expect(mockState.resolvedBranchId).toBe(1);
  });

  it("rejects anonymous and temporary-password accounts before any archive read", async () => {
    await expect(
      callerFor(null).orders.voiceNote({ orderId: 42 })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      callerFor(staffUser({ mustChangePassword: true })).orders.voiceNote({
        orderId: 42,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed across branches and never returns another branch's recording", async () => {
    await expect(
      callerFor(staffUser()).orders.voiceNote({ orderId: 42, branchId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      callerFor(staffUser()).orders.voiceNote({ orderId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockState.resolvedBranchId).toBe(1);
  });
});
