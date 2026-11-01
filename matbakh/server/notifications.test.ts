import { describe, expect, it } from "vitest";
import {
  canReceiveNotification,
  deadlineDedupeKey,
  deadlinePhase,
  isAllowedPushEndpoint,
  staffRole,
} from "./notifications";

describe("notification audience policy", () => {
  const station = { id: 1, role: "station", branchId: 4, isActive: true } as const;
  const kitchen = { id: 2, role: "kitchen", branchId: 4, isActive: true } as const;
  const manager = { id: 3, role: "branch_manager", branchId: 4, isActive: true } as const;
  const system = { id: 4, role: "system_admin", branchId: null, isActive: true } as const;

  it("routes section events to workers and branch monitor roles", () => {
    expect(canReceiveNotification(station, 4, "station")).toBe(true);
    expect(canReceiveNotification(station, 4, "kitchen")).toBe(false);
    expect(canReceiveNotification(kitchen, 4, "kitchen")).toBe(true);
    expect(canReceiveNotification(manager, 4, "station")).toBe(true);
    expect(canReceiveNotification(system, 999, "kitchen")).toBe(true);
  });

  it("keeps inactive and cross-branch accounts out", () => {
    expect(canReceiveNotification({ ...station, branchId: 5 }, 4, "station")).toBe(false);
    expect(canReceiveNotification({ ...station, isActive: false }, 4, "station")).toBe(false);
    expect(staffRole({ id: 9, canKitchen: true, isActive: true })).toBe("kitchen");
    expect(staffRole({ id: 10, role: "unexpected", canKitchen: true, isActive: true })).toBe(null);
  });
});

describe("deadline notification policy", () => {
  const due = new Date("2026-10-27T10:00:00.000Z");
  it("is late as soon as the preparation time runs out", () => {
    expect(deadlinePhase(new Date("2026-10-27T09:59:00.000Z"), due, 5)).toBe("near_due");
    expect(deadlinePhase(new Date("2026-10-27T10:00:00.000Z"), due, 5)).toBe("late");
    expect(deadlinePhase(new Date("2026-10-27T10:02:00.000Z"), due, 5)).toBe("late");
    expect(deadlinePhase(new Date("2026-10-27T10:06:00.000Z"), due, 5)).toBe("late");
    expect(deadlinePhase(new Date("2026-10-27T09:55:00.000Z"), due, 5)).toBe(null);
  });

  it("changes key only for a new deadline revision or phase", () => {
    const first = deadlineDedupeKey(8, "near_due", due);
    expect(deadlineDedupeKey(8, "near_due", due)).toBe(first);
    expect(deadlineDedupeKey(8, "near_due", new Date(due.getTime() + 60_000))).not.toBe(first);
    expect(deadlineDedupeKey(8, "late", due)).not.toBe(first);
  });

  it("uses the persisted item grace snapshot rather than a global default", () => {
    expect(deadlinePhase(new Date("2026-10-27T10:06:00.000Z"), due, 10)).toBe("late");
    expect(deadlinePhase(new Date("2026-10-27T10:06:00.000Z"), due, 5)).toBe("late");
  });
});

describe("push endpoint validation", () => {
  it("allows known HTTPS push providers without ports or credentials", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
  });

  it("rejects SSRF targets, credentials, ports, and non-HTTPS URLs", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/send")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/send")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/send")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/send")).toBe(false);
    expect(isAllowedPushEndpoint("https://example.com/send")).toBe(false);
  });
});
