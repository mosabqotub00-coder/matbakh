import { afterEach, describe, expect, it, vi } from "vitest";
import { scryptSync } from "node:crypto";
const mocks = vi.hoisted(() => ({ existing: [] as Array<{ id: number }>, insert: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn(async () => ({
  select: () => ({ from: () => ({ limit: async () => mocks.existing }) }),
  insert: () => ({ values: mocks.insert }),
})) }));
import { bootstrapFirstManager, hashStaffPassword } from "./staff";

afterEach(() => { vi.restoreAllMocks(); mocks.existing = []; mocks.insert.mockReset(); });
describe("staff password security", () => {
  it("uses distinct random salts and stores only scrypt-derived passwords", async () => {
    const password = "unit-test-password";
    const first = await hashStaffPassword(password);
    const second = await hashStaffPassword(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    const [scheme, salt, digest] = first.split("$");
    expect(scheme).toBe("scrypt");
    expect(scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex")).toBe(digest);
  });
  it("returns initial credentials without writing them to console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await bootstrapFirstManager();
    expect(result.username).toBe("manager");
    expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(20);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: true, canManager: true }));
    expect(mocks.insert.mock.calls[0][0].passwordHash).not.toContain(result.temporaryPassword);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
  it("refuses to overwrite or reset existing staff accounts", async () => {
    mocks.existing = [{ id: 1 }];
    await expect(bootstrapFirstManager()).rejects.toThrow("Staff accounts already exist");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
