import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, inserted: [] as Array<Record<string, unknown>> }));

vi.mock("./db", () => {
  const chain = () => {
    const query: any = {
      select: () => query,
      from: () => query,
      where: () => query,
      limit: async () => state.rows,
      orderBy: async () => state.rows,
    };
    return query;
  };
  return {
    getDb: async () => ({
      select: () => chain(),
      insert: () => ({ values: async (value: Record<string, unknown>) => { state.inserted.push(value); } }),
    }),
  };
});

import { hashStaffPassword, normalizeEmail, signupStaff } from "./staff";

beforeEach(() => {
  state.rows = [];
  state.inserted = [];
});

describe("email signup", () => {
  it("creates a pending, inactive account with a hashed password", async () => {
    const result = await signupStaff({ displayName: "Test User", email: "  New.User@Example.COM ", password: "Strong-pass-123" }, "10.0.0.1");
    expect(result).toEqual({ submitted: true });
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0]!;
    expect(row).toMatchObject({ email: "new.user@example.com", approvalStatus: "pending", isActive: false, canManager: false, canManageUsers: false, branchId: null });
    expect(String(row.passwordHash)).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(String(row.passwordHash)).not.toContain("Strong-pass-123");
    expect(String(row.username)).toMatch(/^new\.user_[0-9a-f]{6}$/);
  });

  it("answers the same way for an email that already exists, without inserting", async () => {
    state.rows = [{ id: 7 }];
    const result = await signupStaff({ displayName: "Someone", email: "taken@example.com", password: "Strong-pass-123" }, "10.0.0.2");
    expect(result).toEqual({ submitted: true });
    expect(state.inserted).toHaveLength(0);
  });

  it("rate-limits repeated signups from one address", async () => {
    for (let index = 0; index < 5; index += 1)
      await signupStaff({ displayName: "User", email: `u${index}@example.com`, password: "Strong-pass-123" }, "10.0.0.3");
    await expect(signupStaff({ displayName: "User", email: "u9@example.com", password: "Strong-pass-123" }, "10.0.0.3")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("normalizes emails and salts each hash", async () => {
    expect(normalizeEmail(" A@B.COM ")).toBe("a@b.com");
    expect(await hashStaffPassword("same-password")).not.toBe(await hashStaffPassword("same-password"));
  });
});
