export function effectiveBranchId(
  user: { role?: string | null; branchId?: number | null } | null | undefined,
  branches: ReadonlyArray<{ id: number }>,
  selected?: number | null
): number | undefined {
  if (user?.role === "system_admin" || user?.role === "developer") {
    return selected != null && branches.some(branch => branch.id === selected)
      ? selected
      : undefined;
  }
  return user?.branchId ?? undefined;
}
