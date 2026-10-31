import { describe, expect, it } from "vitest";
import { parseMatbakhWebMessage, createNativePushCallScript } from "../lib/webview-contract";

describe("Matbakh website to native session bridge", () => {
  it("accepts only the versioned auth state without identities or cookie material", () => {
    const message = parseMatbakhWebMessage(JSON.stringify({
      source: "matbakh-web",
      type: "MATBAKH_AUTH_CHANGED",
      authenticated: true,
      passwordChangeRequired: false,
      apiVersion: 1,
    }));
    expect(message).toMatchObject({ authenticated: true, passwordChangeRequired: false });
  });

  it("rejects wrong source, API version, or missing password-change state", () => {
    expect(parseMatbakhWebMessage(JSON.stringify({ source: "other", type: "MATBAKH_AUTH_CHANGED", authenticated: true, passwordChangeRequired: false, apiVersion: 1 }))).toBeNull();
    expect(parseMatbakhWebMessage(JSON.stringify({ source: "matbakh-web", type: "MATBAKH_AUTH_CHANGED", authenticated: true, passwordChangeRequired: false, apiVersion: 2 }))).toBeNull();
    expect(parseMatbakhWebMessage(JSON.stringify({ source: "matbakh-web", type: "MATBAKH_AUTH_CHANGED", authenticated: true, apiVersion: 1 }))).toBeNull();
    expect(parseMatbakhWebMessage("not-json")).toBeNull();
  });

  it("makes tRPC calls from the authenticated web document with credentials included", () => {
    const script = createNativePushCallScript("register", {
      installationId: "mbx_0123456789abcdef0123456789abcdef01234567",
      expoPushToken: "ExponentPushToken[example]",
      platform: "android",
      appVersion: "1.0.0",
    });
    expect(script).toContain("/api/trpc/nativePush.status?input=");
    expect(script).toContain("/api/trpc/nativePush.register?batch=1");
    expect(script).toContain('credentials: "include"');
    expect(script).toContain("window.__MATBAKH_NATIVE_PUSH_REGISTERED__ = registered");
    expect(script).not.toMatch(/userId|branchId|role|sessionToken|Authorization/i);
  });

  it("posts only the status/operation state back to the Native listener", () => {
    const message = parseMatbakhWebMessage(JSON.stringify({
      source: "matbakh-web", type: "MATBAKH_NATIVE_PUSH_STATE", apiVersion: 1,
      registered: true, success: true, operation: "register",
    }));
    expect(message).toMatchObject({ type: "MATBAKH_NATIVE_PUSH_STATE", registered: true });
  });
});
