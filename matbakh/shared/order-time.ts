export const DEFAULT_GRACE_MINUTES = 5;

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + Math.max(0, minutes) * 60_000);
}

export function preparationDueAt(acceptedAt: Date, prepMinutes: number, extensionMinutes = 0) {
  return addMinutes(acceptedAt, prepMinutes + extensionMinutes);
}

export function graceDueAt(preparationDue: Date, graceMinutes = DEFAULT_GRACE_MINUTES) {
  return addMinutes(preparationDue, graceMinutes);
}

export function isOverdue(at: Date, dueAt: Date | null | undefined) {
  return Boolean(dueAt && at.getTime() > dueAt.getTime());
}

/**
 * Legacy rows did not have a grace-period column. Their historic preparation
 * deadline is deliberately calculated from the original accepted time and the
 * snapshotted preparation duration, rather than retroactively applying a new
 * grace setting.
 */
export function historicPreparationDueAt(acceptedAt: Date | null, prepMinutes: number, extensionMinutes = 0) {
  return acceptedAt ? preparationDueAt(acceptedAt, prepMinutes, extensionMinutes) : null;
}
