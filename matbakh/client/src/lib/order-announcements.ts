export const AUDIO_ANNOUNCED_ORDER_IDS_STORAGE_KEY =
  "matbakh.audio-announced-order-ids";
// Keep this legacy key: it contains overdue audio IDs from previous versions.
export const OVERDUE_ALERTS_STORAGE_KEY = "matbakh.overdue-announced-order-ids";
export const MAX_STORED_ANNOUNCEMENTS = 2000;

export function getAnnouncementStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function parseOrderIds(value: string | null): Set<number> {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is number => Number.isInteger(id) && id > 0)
        : []
    );
  } catch {
    return new Set<number>();
  }
}

export function readStoredOrderIds(
  storage: Pick<Storage, "getItem"> | undefined,
  key: string
): Set<number> {
  if (!storage) return new Set<number>();
  try {
    return parseOrderIds(storage.getItem(key));
  } catch {
    return new Set<number>();
  }
}

export function persistOrderIds(
  ids: Set<number>,
  storage: Pick<Storage, "setItem"> | undefined,
  key: string,
  max = MAX_STORED_ANNOUNCEMENTS
): void {
  const retained = Array.from(ids).slice(-max);
  ids.clear();
  retained.forEach(id => ids.add(id));
  try {
    storage?.setItem(key, JSON.stringify(retained));
  } catch {
    // The in-memory set still prevents duplicates for this page.
  }
}

export function unannouncedOrderIds(
  orderIds: readonly number[],
  announced: ReadonlySet<number>
): number[] {
  return orderIds.filter(id => !announced.has(id));
}
