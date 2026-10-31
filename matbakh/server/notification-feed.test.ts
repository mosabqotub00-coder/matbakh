import { describe, expect, it } from "vitest";
import {
  filterNotificationFeed,
  groupNotificationFeed,
  notificationDayKey,
  type NotificationEntry,
} from "../shared/notification-feed";
const now = new Date("2026-10-27T12:00:00");
const rows: NotificationEntry[] = [
  {
    id: 1,
    title: "تذكرة متأخرة",
    body: "S-DRBXCZ تجاوزت السماح.",
    type: "late",
    orderId: 42,
    createdAt: "2026-10-27T10:00:00",
    read: false,
  },
  {
    id: 2,
    title: "تم الاستلام",
    body: "ضربة رقم ١ انتهت بالتسليم",
    type: "received",
    orderId: 1,
    createdAt: "2026-10-26T09:00:00",
    read: true,
  },
  {
    id: 3,
    title: "جاهز للاستلام",
    body: "بانتظار السخان",
    type: "ready",
    orderId: 43,
    createdAt: "2026-10-27T11:00:00",
    read: false,
  },
  {
    id: 4,
    title: "تنبيه سابق",
    body: "ملاحظة محفوظة",
    type: "late",
    orderId: 44,
    createdAt: "2026-10-15T11:00:00",
    read: true,
  },
];
describe("notification center and read archive", () => {
  it("separates unread notifications from the read archive without deleting anything", () => {
    expect(
      filterNotificationFeed(rows, { mode: "new" }).map(row => row.id)
    ).toEqual([3, 1]);
    expect(
      filterNotificationFeed(rows, { mode: "archive" }).map(row => row.id)
    ).toEqual([2, 4]);
    expect(rows).toHaveLength(4);
    expect(rows[0].read).toBe(false);
  });
  it("finds Arabic and Western ticket numbers and old references", () => {
    for (const search of ["٤٢", "42", "ضربة رقم ٤٢", "S-DRBXCZ"]) {
      expect(
        filterNotificationFeed(rows, { mode: "new", search }).map(row => row.id)
      ).toEqual([1]);
    }
  });
  it("combines type and read-archive filters", () => {
    expect(
      filterNotificationFeed(rows, { mode: "archive", kind: "late" }).map(
        row => row.id
      )
    ).toEqual([4]);
  });
  it("filters today and the last seven calendar days", () => {
    expect(
      filterNotificationFeed(rows, { mode: "new", period: "today", now })
    ).toHaveLength(2);
    expect(
      filterNotificationFeed(rows, {
        mode: "archive",
        period: "week",
        now,
      }).map(row => row.id)
    ).toEqual([2]);
  });
  it("groups complete messages by day using fixed dates", () => {
    const groups = groupNotificationFeed(
      filterNotificationFeed(rows, { mode: "new" }),
      now
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("إشعارات اليوم");
    expect(groups[0].rows[1].body).toBe("S-DRBXCZ تجاوزت السماح.");
    expect(notificationDayKey("invalid")).toBe("unknown");
  });
  it("moves a reviewed notification to the archive via the existing read flag", () => {
    const updated = rows.map(row =>
      row.id === 1 ? { ...row, read: true } : row
    );
    expect(
      filterNotificationFeed(updated, { mode: "new" }).map(row => row.id)
    ).toEqual([3]);
    expect(
      filterNotificationFeed(updated, { mode: "archive" }).map(row => row.id)
    ).toEqual([1, 2, 4]);
  });
});
