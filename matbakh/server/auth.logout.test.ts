import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { STAFF_SESSION_COOKIE } from "./staff";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; options: Record<string, unknown> };

function createContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];
  const ctx: TrpcContext = {
    staffUser: null,
    staffSessionHash: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

afterEach(() => vi.unstubAllEnvs());

describe("auth.logout", () => {
  it("clears the staff session cookie with production-safe defaults", async () => {
    vi.stubEnv("COOKIE_SAME_SITE", "");
    vi.stubEnv("COOKIE_SECURE", "");
    const { ctx, clearedCookies } = createContext();
    const result = await appRouter.createCaller(ctx).auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(STAFF_SESSION_COOKIE);
    expect(clearedCookies[0]?.options).toMatchObject({ maxAge: 0, secure: true, sameSite: "lax", httpOnly: true, path: "/" });
  });

  it("forces Secure when SameSite=None is configured", async () => {
    vi.stubEnv("COOKIE_SAME_SITE", "none");
    vi.stubEnv("COOKIE_SECURE", "false");
    const { ctx, clearedCookies } = createContext();
    await appRouter.createCaller(ctx).auth.logout();
    expect(clearedCookies[0]?.options).toMatchObject({ secure: true, sameSite: "none" });
  });
});
