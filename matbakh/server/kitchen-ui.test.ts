import { describe, expect, it } from "vitest";
import {
  completionInfo,
  dateTime,
  deliverySeconds,
  graceDueAt,
  isOverdue,
  phaseSeconds,
  spokenOrderNumber,
  type KitchenOrder,
} from "../client/src/lib/kitchen-ui";

const order: KitchenOrder = {
  id: 42,
  orderCode: "S-20261027-42",
  status: "preparing",
  createdAt: "2026-10-27T12:00:00Z",
  acceptedAt: "2026-10-27T12:00:00Z",
  effectiveDueAt: "2026-10-27T12:10:00Z",
  items: [
    {
      id: 1,
      productName: "كرسبي",
      quantity: 1,
      prepMinutes: 10,
      graceMinutes: 2,
    },
  ],
};

describe("operator deadline and display helpers", () => {
  it("uses the item grace snapshot instead of the default five", () => {
    expect(graceDueAt(order)).toEqual(new Date("2026-10-27T12:12:00Z"));
    expect(isOverdue(order, new Date("2026-10-27T12:11:00Z").getTime())).toBe(
      false
    );
    expect(isOverdue(order, new Date("2026-10-27T12:13:00Z").getTime())).toBe(
      true
    );
  });
  it("preserves a zero-minute grace snapshot", () => {
    expect(
      graceDueAt({ ...order, items: [{ ...order.items[0], graceMinutes: 0 }] })
    ).toEqual(new Date(order.effectiveDueAt!));
  });
  it("never pronounces a random legacy code", () => {
    expect(spokenOrderNumber({ ...order, orderCode: "S-DRBXCZ" })).toBe("42");
    expect(spokenOrderNumber(order)).toBe("42");
  });
  it("freezes the received delivery duration even on later refresh", () => {
    const received = {
      ...order,
      status: "received" as const,
      readyAt: "2026-10-27T12:10:00Z",
      receivedAt: "2026-10-27T12:12:00Z",
    };
    expect(
      phaseSeconds(received, new Date("2026-10-28T12:00:00Z").getTime())
    ).toBe(120);
  });
  it("shows a fixed readiness timestamp instead of a counter days later", () => {
    const ready = {
      ...order,
      status: "ready" as const,
      readyAt: "2026-10-27T12:10:00Z",
    };
    const summary = completionInfo(ready);
    expect(summary).toEqual({
      label: "جهزت في",
      value: dateTime(ready.readyAt),
    });
    expect(
      phaseSeconds(ready, new Date("2026-10-27T13:00:00Z").getTime())
    ).toBe(0);
    expect(
      phaseSeconds(ready, new Date("2026-11-30T13:00:00Z").getTime())
    ).toBe(0);
    expect(deliverySeconds(ready)).toBeNull();
    expect(completionInfo(ready)).toEqual(summary);
  });
  it("uses the actual delivery end timestamp and frozen duration", () => {
    const received = {
      ...order,
      status: "received" as const,
      readyAt: "2026-10-27T12:10:00Z",
      receivedAt: "2026-10-27T12:12:00Z",
    };
    expect(completionInfo(received)).toEqual({
      label: "انتهت بالتسليم",
      value: dateTime(received.receivedAt),
    });
    expect(deliverySeconds(received)).toBe(120);
    expect(
      phaseSeconds(received, new Date("2027-01-01T12:00:00Z").getTime())
    ).toBe(120);
  });
  it("never invents delivery time for a legacy record missing receivedAt", () => {
    const legacy = {
      ...order,
      status: "received" as const,
      readyAt: "2026-10-27T12:10:00Z",
      receivedAt: null,
    };
    expect(deliverySeconds(legacy)).toBeNull();
    expect(completionInfo(legacy).value).toBe("—");
    expect(
      phaseSeconds(legacy, new Date("2026-11-30T13:00:00Z").getTime())
    ).toBe(0);
  });
  it("does not show invalid or reversed delivery durations", () => {
    const received = {
      ...order,
      status: "received" as const,
      readyAt: "2026-10-27T12:10:00Z",
      receivedAt: "not-a-date",
    };
    expect(deliverySeconds(received)).toBeNull();
    expect(
      deliverySeconds({ ...received, receivedAt: "2026-10-27T12:00:00Z" })
    ).toBeNull();
  });
  it("keeps new and preparing timers live", () => {
    const now = new Date("2026-10-27T12:15:00Z").getTime();
    expect(phaseSeconds({ ...order, status: "new" }, now)).toBe(900);
    expect(phaseSeconds(order, now)).toBe(900);
    expect(phaseSeconds(order, now + 1000)).toBe(901);
  });
  it("includes a Gregorian date matching the ticket date", () => {
    expect(dateTime("2026-10-27T12:10:00Z")).toMatch(/2026|٢٠٢٦/);
  });
});
