import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kitchenOrderItems, kitchenOrders } from "../drizzle/schema";
import { getDb } from "./db";
import { extendOrder, receiveOrder, transitionOrder } from "./kitchen";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./notifications", () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}));

const actor = {
  id: 7,
  role: "kitchen_manager" as const,
  branchId: 2,
  displayName: "مدير المطبخ",
  isActive: true,
};
const acceptedAt = new Date("2026-10-27T12:00:00Z");
const deadline = new Date("2026-10-27T12:10:00Z");

type MockOrder = Record<string, any>;
function mockedDatabase(initial: Partial<MockOrder> = {}) {
  const order: MockOrder = {
    id: 3,
    branchId: 2,
    orderCode: "S-20261027-3",
    status: "preparing",
    acceptedAt,
    originalDueAt: deadline,
    effectiveDueAt: deadline,
    extensionMinutes: 0,
    everOverdue: false,
    readyAt: null,
    ...initial,
  };
  const item = { id: 1, orderId: 3, prepMinutes: 10, graceMinutes: 5 };
  const updates: Array<Record<string, any>> = [];
  const events: Array<Record<string, any>> = [];
  const locks = vi.fn();
  const tx = {
    select() {
      let table: unknown;
      const rows = () =>
        table === kitchenOrders
          ? [order]
          : table === kitchenOrderItems
            ? [item]
            : [];
      const builder: any = {
        from(value: unknown) {
          table = value;
          return builder;
        },
        where() {
          return builder;
        },
        limit() {
          return builder;
        },
        for(mode: string) {
          locks(mode);
          return builder;
        },
        then(
          resolve: (rows: unknown[]) => void,
          reject: (error: unknown) => void
        ) {
          return Promise.resolve(rows()).then(resolve, reject);
        },
      };
      return builder;
    },
    update() {
      return {
        set(patch: Record<string, unknown>) {
          return {
            async where() {
              updates.push(patch);
              Object.assign(order, patch);
              return [{ affectedRows: 1 }];
            },
          };
        },
      };
    },
    insert() {
      return {
        async values(value: Record<string, unknown>) {
          events.push(value);
          return [{ insertId: events.length }];
        },
      };
    },
  };
  const db = {
    transaction: async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  vi.mocked(getDb).mockResolvedValue(
    db as unknown as Awaited<ReturnType<typeof getDb>>
  );
  return { order, item, updates, events, locks };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:12:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("preparation, grace, extension, and handover", () => {
  it("labels readiness after the preparation time as late, even within grace", async () => {
    const db = mockedDatabase();
    await transitionOrder(actor, { orderId: 3, nextStatus: "ready" });
    expect(db.order.status).toBe("ready");
    expect(db.order.everOverdue).toBe(true);
    expect(db.locks).toHaveBeenCalledWith("update");
  });
  it("keeps late history when readiness follows grace", async () => {
    vi.setSystemTime(new Date("2026-10-27T12:16:00Z"));
    const db = mockedDatabase();
    await transitionOrder(actor, { orderId: 3, nextStatus: "ready" });
    expect(db.order.everOverdue).toBe(true);
  });
  it("preserves a prior late event when extending after grace without a cron", async () => {
    vi.setSystemTime(new Date("2026-10-27T12:16:00Z"));
    const db = mockedDatabase();
    await extendOrder(actor, {
      orderId: 3,
      minutes: 10,
      reason: "يحتاج تجهيزًا إضافيًا",
    });
    expect(db.order.effectiveDueAt).toEqual(new Date("2026-10-27T12:20:00Z"));
    expect(db.order.originalDueAt).toEqual(deadline);
    expect(db.order.everOverdue).toBe(true);
    expect(db.events[0]).toMatchObject({
      kind: "extended",
      addedMinutes: 10,
      previousDueAt: deadline,
      reason: "يحتاج تجهيزًا إضافيًا",
    });
    expect(db.locks).toHaveBeenCalledWith("update");
  });
  it("adds each extension to the previous effective deadline", async () => {
    const db = mockedDatabase();
    await extendOrder(actor, { orderId: 3, minutes: 3, reason: "سبب أول" });
    await extendOrder(actor, { orderId: 3, minutes: 4, reason: "سبب آخر" });
    expect(db.order.extensionMinutes).toBe(7);
    expect(db.order.effectiveDueAt).toEqual(new Date("2026-10-27T12:17:00Z"));
    expect(db.order.originalDueAt).toEqual(deadline);
    expect(db.locks).toHaveBeenCalledTimes(2);
  });
  it("rejects extending a ready ticket", async () => {
    const db = mockedDatabase({ status: "ready" });
    await expect(
      extendOrder(actor, {
        orderId: 3,
        minutes: 5,
        reason: "لا يجوز بعد الجاهزية",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(db.updates).toHaveLength(0);
  });
  it("refuses handover until ready", async () => {
    const db = mockedDatabase();
    await expect(receiveOrder(actor, { orderId: 3 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(db.updates).toHaveLength(0);
  });
  it("records the receiving user and timestamp without altering readiness", async () => {
    const readyAt = new Date("2026-10-27T12:11:00Z");
    const db = mockedDatabase({ status: "ready", readyAt });
    await receiveOrder(actor, { orderId: 3 });
    expect(db.order).toMatchObject({
      status: "received",
      receivedById: 7,
      receivedByName: "مدير المطبخ",
      readyAt,
    });
    expect(db.order.receivedAt).toEqual(new Date("2026-10-27T12:12:00Z"));
    expect(db.events[0]).toMatchObject({ kind: "received", actorId: 7 });
    expect(db.locks).toHaveBeenCalledWith("update");
  });
  it("queues external readiness in the same transaction", async () => {
    const db = mockedDatabase({ orderSource: "external", externalOrderId: "external-1", externalItemId: "item-1" });
    await transitionOrder(actor, { orderId: 3, nextStatus: "ready" });
    const outbox = db.events.find(event => event.eventType === "order.ready");
    expect(outbox).toMatchObject({ branchId: 2, orderId: 3, status: "pending" });
    expect(JSON.parse(outbox!.payload)).toMatchObject({ externalOrderId: "external-1", externalItemId: "item-1", status: "ready" });
  });
  it("queues external receipt without actually sending a webhook", async () => {
    const db = mockedDatabase({ orderSource: "external", externalOrderId: "external-1", externalItemId: "item-1", status: "ready" });
    await receiveOrder(actor, { orderId: 3 });
    expect(db.events.find(event => event.eventType === "order.received")).toMatchObject({ branchId: 2, orderId: 3, status: "pending" });
  });
});
