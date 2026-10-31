import { describe, expect, it } from "vitest";
import { notificationTargetFromData } from "../lib/notification-routing";
import { MATBAKH_ORIGIN } from "../lib/native-bridge";

describe("notification deep-link routing", () => {
  it("opens the server-approved in-site route, preserving ticket identity", () => {
    expect(notificationTargetFromData({ url: "/kitchen?orderId=42", orderId: 42 })).toEqual({
      url: `${MATBAKH_ORIGIN}/kitchen?orderId=42`,
      path: "/kitchen?orderId=42",
    });
  });

  it("routes a kitchen alert to the kitchen when no explicit URL exists", () => {
    expect(notificationTargetFromData({ targetSection: "kitchen" }).path).toBe("/kitchen");
  });

  it("routes a heater/station alert to the station home", () => {
    expect(notificationTargetFromData({ targetSection: "station" }).path).toBe("/");
    expect(notificationTargetFromData({ targetSection: "heater" }).path).toBe("/");
  });

  it("falls back to the site notifications section for unknown alert types", () => {
    expect(notificationTargetFromData({ targetSection: "unknown" }).path).toBe("/notifications");
    expect(notificationTargetFromData(null).path).toBe("/notifications");
  });

  it("never follows an external or unapproved redirect supplied by push payload", () => {
    expect(notificationTargetFromData({ url: "https://evil.example/kitchen", targetSection: "kitchen" }).path).toBe("/kitchen");
    expect(notificationTargetFromData({ url: "https://matbakh.click/login" }).path).toBe("/notifications");
  });
});
