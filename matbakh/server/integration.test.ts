import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  EXTERNAL_ACTOR_NAME,
  assertCanManageIntegration,
  canManageIntegration,
  createIntegrationKey,
  extractBearerToken,
  formatExternalOrderCode,
  hashIntegrationKey,
  integrationSchemas,
  isPrivateOrLocalAddress,
  verifyIntegrationKey,
} from "./integration";

describe("integration pure contracts", () => {
  it("creates a random bearer key and never treats its hash as the secret", () => {
    const first = createIntegrationKey();
    const second = createIntegrationKey();
    expect(first.secret.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(first.secret).not.toBe(second.secret);
    expect(first.tokenHash).toBe(hashIntegrationKey(first.secret));
    expect(verifyIntegrationKey(first.secret, first.tokenHash)).toBe(true);
    expect(verifyIntegrationKey(second.secret, first.tokenHash)).toBe(false);
    expect(first.tokenHash).not.toContain(first.secret);
    expect(first.tokenPrefix).toBe(first.secret.slice(0, 16));
  });

  it("extracts only a strict Authorization Bearer token", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
    expect(extractBearerToken("Basic abc123")).toBeNull();
    expect(extractBearerToken("Bearer a b")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("keeps management roles branch-scoped", () => {
    const system = { id: 1, role: "system_admin", branchId: 5, isActive: true };
    const branchManager = { id: 2, role: "branch_manager", branchId: 5, isActive: true };
    const kitchenManager = { id: 3, role: "kitchen_manager", branchId: 5, canManager: true, isActive: true };
    expect(canManageIntegration(system, 99)).toBe(true);
    expect(canManageIntegration(branchManager, 5)).toBe(true);
    expect(canManageIntegration(branchManager, 6)).toBe(false);
    expect(canManageIntegration(kitchenManager, 5)).toBe(false);
    expect(() => assertCanManageIntegration(branchManager, 6)).toThrowError(/مدير النظام/);
  });

  it("preserves a stable readable numeric display code", () => {
    expect(formatExternalOrderCode(new Date("2026-10-27T08:49:46.000Z"), 42)).toBe("S-20261027-42");
    expect(() => formatExternalOrderCode(new Date(), 0)).toThrow();
    expect(EXTERNAL_ACTOR_NAME).toBe("التكامل الخارجي");
  });

  it("validates one ticket per external item and quantity bounds before database work", () => {
    const valid = integrationSchemas.externalOrderInput.parse({
      externalOrderId: "ERP-100", items: [{ externalItemId: "line-1", productId: 7, quantity: 99 }],
    });
    expect(valid.items[0].quantity).toBe(99);
    expect(() => integrationSchemas.externalOrderInput.parse({
      externalOrderId: "ERP-100", items: [{ externalItemId: "line-1", productId: 7, quantity: 100 }],
    })).toThrow();
    expect(() => integrationSchemas.externalOrderInput.parse({
      externalOrderId: "ERP-100", items: [{ externalItemId: "line-1", productId: 7, quantity: 0 }],
    })).toThrow();
  });

  it("rejects private, loopback, link-local, and mapped-private destinations", () => {
    expect(isPrivateOrLocalAddress("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalAddress("10.0.0.4")).toBe(true);
    expect(isPrivateOrLocalAddress("172.16.0.2")).toBe(true);
    expect(isPrivateOrLocalAddress("192.168.1.4")).toBe(true);
    expect(isPrivateOrLocalAddress("169.254.10.2")).toBe(true);
    expect(isPrivateOrLocalAddress("::1")).toBe(true);
    expect(isPrivateOrLocalAddress("fe80::1")).toBe(true);
    expect(isPrivateOrLocalAddress("::ffff:192.168.1.4")).toBe(true);
    expect(isPrivateOrLocalAddress("203.0.113.10")).toBe(false);
    expect(isPrivateOrLocalAddress("2001:db8::10")).toBe(false);
  });
});
