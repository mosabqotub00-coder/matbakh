import { describe, expect, it } from "vitest";
import { effectiveBranchId } from "../shared/branch-selection";
import { filterStaffAccounts } from "./staff";
import type { BranchActor } from "./branches";

const branches = [
  { id: 1, name: "فرع سفيان" },
  { id: 2, name: "فرع فيصل" },
];
const admin: BranchActor = { id: 1, role: "system_admin", branchId: null };
const director: BranchActor = { id: 2, role: "branch_manager", branchId: 2 };
const accounts = [
  { id: 1, role: "system_admin" as const, branchId: null },
  { id: 2, role: "branch_manager" as const, branchId: 2 },
  { id: 3, role: "station" as const, branchId: 2 },
  { id: 4, role: "branch_manager" as const, branchId: 1 },
  { id: 5, role: "kitchen" as const, branchId: 1 },
];

describe("general administration separate from Faisal", () => {
  it("never chooses Faisal or the first branch implicitly", () => {
    expect(effectiveBranchId(admin, branches)).toBeUndefined();
    expect(
      effectiveBranchId({ ...admin, branchId: 2 }, branches)
    ).toBeUndefined();
  });
  it("accepts explicit selection and supports returning to no branch", () => {
    expect(effectiveBranchId(admin, branches, 2)).toBe(2);
    expect(effectiveBranchId(admin, branches, null)).toBeUndefined();
    expect(effectiveBranchId(admin, branches, 999)).toBeUndefined();
  });
  it("workers stay in their account branch regardless of selection", () => {
    expect(effectiveBranchId(director, branches, 1)).toBe(2);
  });
  it("lists only system accounts in general administration", () => {
    expect(
      filterStaffAccounts(accounts, admin, undefined, "system").map(
        row => row.id
      )
    ).toEqual([1]);
    expect(() => filterStaffAccounts(accounts, admin, 2, "system")).toThrow();
  });
  it("lists branch directors separately from system and worker accounts", () => {
    expect(
      filterStaffAccounts(accounts, admin, undefined, "branch_managers").map(
        row => row.id
      )
    ).toEqual([2, 4]);
  });
  it("requires explicit branch for its account view and excludes global accounts", () => {
    expect(() =>
      filterStaffAccounts(accounts, admin, undefined, "branch")
    ).toThrow();
    expect(
      filterStaffAccounts(accounts, admin, 2, "branch").map(row => row.id)
    ).toEqual([2, 3]);
  });
  it("forbids branch managers from general and other director accounts", () => {
    expect(() =>
      filterStaffAccounts(accounts, director, undefined, "system")
    ).toThrow();
    expect(() =>
      filterStaffAccounts(accounts, director, undefined, "branch_managers")
    ).toThrow();
    expect(() =>
      filterStaffAccounts(accounts, director, 1, "branch")
    ).toThrow();
    expect(
      filterStaffAccounts(accounts, director, 2, "branch").map(row => row.id)
    ).toEqual([3]);
  });
});
