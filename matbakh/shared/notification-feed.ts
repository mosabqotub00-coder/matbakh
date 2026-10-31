import {
  humanTicketText,
  normalizeTicketSearch,
  ticketLabel,
} from "./ticket-label";

export type NotificationEntry = {
  id: number;
  title: string;
  body: string;
  type: string;
  orderId: number | null;
  createdAt: Date | string;
  read: boolean;
};
export type NotificationFeedMode = "new" | "archive";
export type NotificationPeriod = "all" | "today" | "week";
export type NotificationFilters = {
  mode: NotificationFeedMode;
  search?: string;
  kind?: string;
  period?: NotificationPeriod;
  now?: Date;
};

const dateOf = (value: Date | string) => new Date(value);
export function notificationDayKey(value: Date | string): string {
  const date = dateOf(value);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function filterNotificationFeed(
  rows: NotificationEntry[],
  filters: NotificationFilters
): NotificationEntry[] {
  const now = filters.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  const query = normalizeTicketSearch(filters.search ?? "");
  return rows
    .filter(row => {
      if (Boolean(row.read) !== (filters.mode === "archive")) return false;
      if (filters.kind && filters.kind !== "all" && row.type !== filters.kind)
        return false;
      if (
        filters.period === "today" &&
        notificationDayKey(row.createdAt) !== notificationDayKey(now)
      )
        return false;
      if (
        filters.period === "week" &&
        (dateOf(row.createdAt).getTime() < cutoff.getTime() ||
          !Number.isFinite(dateOf(row.createdAt).getTime()))
      )
        return false;
      const label = row.orderId ? ticketLabel({ id: row.orderId }) : "";
      const readable = row.orderId
        ? humanTicketText(row.body, { id: row.orderId })
        : row.body;
      return (
        !query ||
        normalizeTicketSearch(
          `${row.title} ${row.body} ${readable} ${label} ${row.orderId ?? ""}`
        ).includes(query)
      );
    })
    .sort(
      (a, b) =>
        (dateOf(b.createdAt).getTime() || 0) -
        (dateOf(a.createdAt).getTime() || 0)
    );
}

export function groupNotificationFeed(
  rows: NotificationEntry[],
  now = new Date()
) {
  const groups: Array<{
    key: string;
    label: string;
    rows: NotificationEntry[];
  }> = [];
  for (const row of rows) {
    const key = notificationDayKey(row.createdAt);
    let group = groups.find(value => value.key === key);
    if (!group) {
      const label =
        key === "unknown"
          ? "تاريخ غير متاح"
          : key === notificationDayKey(now)
            ? "إشعارات اليوم"
            : new Intl.DateTimeFormat("ar-EG-u-ca-gregory", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(dateOf(row.createdAt));
      group = { key, label, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}
