import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffUser } from "../drizzle/schema";
const mocks = vi.hoisted(() => ({ accounts: [] as StaffUser[], update: vi.fn(), revoke: vi.fn(), lock: vi.fn() }));
vi.mock("./db", () => ({ getDb: async () => ({ transaction: async (fn: (tx: unknown) => unknown) => fn({
  select: () => ({ from: () => ({ orderBy: () => ({ for: async (mode: string) => { mocks.lock(mode); return mocks.accounts; } }) }) }),
  update: () => ({ set: (value: unknown) => ({ where: async () => { mocks.update(value); } }) }),
  delete: () => ({ where: async () => { mocks.revoke(); } }),
}) }) }));
import { updateStaffAccount } from "./staff";
const account = (id: number): StaffUser => ({ id, username: `manager${id}`, displayName: "مدير", passwordHash: "unused-test-hash", role: "system_admin", branchId: null, canStation: true, canKitchen: true, canManager: true, canManageUsers: true, canBroadcast: true, canExtend: true, isActive: true, mustChangePassword: false, createdAt: new Date(), updatedAt: new Date() });
beforeEach(() => { mocks.accounts = [account(1)]; vi.clearAllMocks(); });
describe("staff account transactional safeguards", () => {
  it("locks account rows and rejects disabling the final manager", async () => {
    await expect(updateStaffAccount({ id: 1, isActive: false })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.lock).toHaveBeenCalledWith("update");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects removing the only active manager permission", async () => {
    await expect(updateStaffAccount({ id: 1, role: "branch_manager", branchId: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("allows disabling a manager if another remains and revokes sessions", async () => {
    mocks.accounts = [account(1), account(2)];
    const result = await updateStaffAccount({ id: 1, isActive: false });
    expect(result.isActive).toBe(false);
    expect(result).not.toHaveProperty("passwordHash");
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });
  it("resets password with a hash and requires replacement while revoking sessions", async () => {
    const result = await updateStaffAccount({ id: 1, password: "new-unit-test-password" });
    expect(result.mustChangePassword).toBe(true);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: expect.stringMatching(/^scrypt\$/) }));
    expect(result).not.toHaveProperty("passwordHash");
    expect(mocks.revoke).toHaveBeenCalledOnce();
  });
});
