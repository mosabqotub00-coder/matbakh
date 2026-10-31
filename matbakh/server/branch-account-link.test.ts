import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffUser } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ accounts: [] as StaffUser[], inserted: vi.fn(), updated: vi.fn(), branch: vi.fn(), available: true }));
vi.mock("./branches", async original => ({ ...await original<typeof import("./branches")>(), getBranch: mocks.branch }));
vi.mock("./db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.accounts }), orderBy: () => ({ for: async () => mocks.accounts }) }) }),
    insert: () => ({ values: async (value: Partial<StaffUser>) => { mocks.inserted(value); mocks.accounts = [{ id: 30, createdAt: new Date(), updatedAt: new Date(), ...value } as StaffUser]; } }),
    update: () => ({ set: (value: unknown) => ({ where: async () => mocks.updated(value) }) }),
    delete: () => ({ where: async () => {} }),
  };
  return { getDb: async () => mocks.available ? { ...tx, transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } : null };
});
import { createStaffAccount, updateStaffAccount, revokeStaffSession } from "./staff";

const system = { id: 1, role: "system_admin" as const, branchId: null, isActive: true };
const input = { username: "station_faisal_morning", displayName: "موظف السخان الصباحي", password: "test-temporary-password", role: "station" as const, branchId: 1, usualShift: "morning" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts = [];
  mocks.available = true;
  mocks.branch.mockResolvedValue({ id: 1, name: "فرع فيصل", ordersEnabled: true });
});

describe("branch account linkage", () => {
  it("rejects a branch-scoped account with no branch", async () => {
    await expect(createStaffAccount(system, { ...input, branchId: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.inserted).not.toHaveBeenCalled();
  });
  it("rejects a positive but nonexistent branch before inserting", async () => {
    mocks.branch.mockRejectedValue({ code: "NOT_FOUND" });
    await expect(createStaffAccount(system, { ...input, branchId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.branch).toHaveBeenCalledWith(999);
    expect(mocks.inserted).not.toHaveBeenCalled();
  });
  it("keeps branch and morning shift and requires a password change", async () => {
    const user = await createStaffAccount(system, input);
    expect(user).toMatchObject({ branchId: 1, usualShift: "morning", role: "station", mustChangePassword: true });
    expect(user).not.toHaveProperty("passwordHash");
    expect(mocks.inserted).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: expect.stringMatching(/^scrypt\$/) }));
  });
  it("allows a user for an unopened branch without enabling orders", async () => {
    mocks.branch.mockResolvedValue({ id: 3, name: "فرع رفيديا", ordersEnabled: false });
    const user = await createStaffAccount(system, { ...input, branchId: 3, usualShift: "evening" });
    expect(user).toMatchObject({ branchId: 3, usualShift: "evening" });
  });
  it("blocks a branch manager from creating a user for another branch", async () => {
    await expect(createStaffAccount({ id: 5, role: "branch_manager", branchId: 1 }, { ...input, branchId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.inserted).not.toHaveBeenCalled();
  });
  it("keeps a global developer account unassigned to any branch", async () => {
    const user = await createStaffAccount(system, { ...input, username: "developer", role: "developer", branchId: 1 });
    expect(user).toMatchObject({ role: "developer", branchId: null });
    expect(mocks.branch).not.toHaveBeenCalled();
  });
  it("rejects moving an existing branch user to a missing branch", async () => {
    mocks.accounts = [{ id: 3, username: input.username, displayName: input.displayName, role: input.role, branchId: 1, usualShift: "morning", isActive: true, mustChangePassword: false, passwordHash: "unused", canStation: true, canKitchen: false, canManager: false, canManageUsers: false, canBroadcast: false, canExtend: false, createdAt: new Date(), updatedAt: new Date() }];
    mocks.branch.mockRejectedValue({ code: "NOT_FOUND" });
    await expect(updateStaffAccount(system, { id: 3, branchId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.updated).not.toHaveBeenCalled();
  });
  it("does not report a revoked session when the database is unavailable", async () => {
    mocks.available = false;
    await expect(revokeStaffSession("some-token")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
