import { ticketNumber } from "../../../shared/ticket-label";
export {
  ticketLabel,
  normalizeTicketSearch,
} from "../../../shared/ticket-label";

export type KitchenStatus = "new" | "preparing" | "ready" | "received";
export type KitchenItem = {
  id: number;
  productId?: number;
  productName: string;
  quantity: number;
  prepMinutes: number;
  graceMinutes?: number;
  hasTimer?: boolean;
};
export type KitchenEvent = {
  id: number;
  status: KitchenStatus;
  kind?: string | null;
  actor?: string | null;
  createdAt: Date | string;
  reason?: string | null;
  detail?: string | null;
  addedMinutes?: number | null;
  previousDueAt?: Date | string | null;
  newDueAt?: Date | string | null;
};
export type KitchenOrder = {
  id: number;
  orderCode: string;
  status: KitchenStatus;
  items: KitchenItem[];
  events?: KitchenEvent[];
  notes?: string | null;
  voiceAvailable?: boolean;
  createdAt: Date | string;
  acceptedAt?: Date | string | null;
  readyAt?: Date | string | null;
  receivedAt?: Date | string | null;
  originalDueAt?: Date | string | null;
  effectiveDueAt?: Date | string | null;
  graceMinutes?: number | null;
  extensionMinutes?: number | null;
  everOverdue?: boolean | null;
  source?: "internal" | "kitchen_manager" | "external" | string;
  orderSource?: "internal" | "kitchen_manager" | "external" | string;
  createdByName?: string | null;
  createdById?: number | null;
  acceptedByName?: string | null;
  receivedByName?: string | null;
  branchId?: number | null;
  [key: string]: unknown;
};
export type Product = {
  id: number;
  name: string;
  category: string;
  prepMinutes: number;
  graceMinutes?: number;
  hasTimer?: boolean;
  isActive: boolean;
  branchId?: number | null;
};

export const STATUS_LABEL: Record<KitchenStatus, string> = {
  new: "طلب جديد",
  preparing: "قيد التحضير",
  ready: "جاهز",
  received: "مستلم",
};
export const STATUS_TONE: Record<KitchenStatus, string> = {
  new: "waiting",
  preparing: "preparing",
  ready: "ready",
  received: "received",
};

export const toDate = (value: Date | string | null | undefined) =>
  value ? new Date(value) : null;
export const dateTime = (value: Date | string | null | undefined) => {
  const date = toDate(value);
  return !date || Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("ar-SA", {
        calendar: "gregory",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};
export const clock = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600),
    m = Math.floor((safe % 3600) / 60),
    s = safe % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
export const elapsedSeconds = (
  value: Date | string | null | undefined,
  now: number
) =>
  value ? Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000)) : 0;
export const maxPrepSeconds = (order: KitchenOrder) =>
  order.items.some(item => item.hasTimer === false)
    ? 0
    : Math.max(0, ...order.items.map(item => item.prepMinutes)) * 60;
export const dueAt = (order: KitchenOrder) =>
  order.items.some(item => item.hasTimer === false)
    ? null
    : order.effectiveDueAt ??
      order.originalDueAt ??
      (order.acceptedAt
        ? new Date(
            new Date(order.acceptedAt).getTime() + maxPrepSeconds(order) * 1000
          )
        : null);
export const graceDueAt = (order: KitchenOrder) => {
  const due = dueAt(order);
  const snapshotGrace = order.items[0]?.graceMinutes ?? order.graceMinutes ?? 5;
  return due
    ? new Date(new Date(due).getTime() + snapshotGrace * 60_000)
    : null;
};
export const remainingSeconds = (order: KitchenOrder, now: number) => {
  const due = graceDueAt(order);
  return due ? Math.floor((new Date(due).getTime() - now) / 1000) : 0;
};
export const effectiveRemainingSeconds = (order: KitchenOrder, now: number) => {
  const due = dueAt(order);
  return due ? Math.floor((new Date(due).getTime() - now) / 1000) : 0;
};
export const isOverdue = (order: KitchenOrder, now: number) =>
  order.status === "preparing" && Boolean(dueAt(order)) && effectiveRemainingSeconds(order, now) < 0;
export const deliverySeconds = (order: KitchenOrder): number | null => {
  if (order.status !== "received" || !order.readyAt || !order.receivedAt)
    return null;
  const ready = new Date(order.readyAt).getTime();
  const received = new Date(order.receivedAt).getTime();
  if (!Number.isFinite(ready) || !Number.isFinite(received) || received < ready)
    return null;
  return Math.floor((received - ready) / 1000);
};
export const completionInfo = (order: KitchenOrder) => ({
  label: order.status === "received" ? "انتهت بالتسليم" : "جهزت في",
  value: dateTime(
    order.status === "received" ? order.receivedAt : order.readyAt
  ),
});
export const phaseSeconds = (order: KitchenOrder, now: number) =>
  order.status === "preparing"
    ? elapsedSeconds(order.acceptedAt, now)
    : order.status === "received"
      ? (deliverySeconds(order) ?? 0)
      : order.status === "ready"
        ? 0
        : elapsedSeconds(order.createdAt, now);
export const spokenOrderNumber = (order: KitchenOrder) => {
  return ticketNumber(order);
};
export const orderAnnouncementText = (order: KitchenOrder) => {
  const items = order.items
    .map(item => `${item.quantity} ${item.productName}`)
    .join("، ");
  const notes = order.notes?.replace(/\s+/g, " ").trim();
  return `ضربة رقم ${spokenOrderNumber(order)}، ${items}.${notes ? ` ملاحظات المطبخ: ${notes}.` : ""}${order.voiceAvailable ? " يوجد تعليق صوتي مرفق يمكن الاستماع إليه." : ""}`;
};
export const sourceLabel = (order: KitchenOrder) =>
  (order.orderSource ?? order.source) === "kitchen_manager"
    ? "أنشأه مدير المطبخ"
    : (order.orderSource ?? order.source) === "external"
      ? "مصدر خارجي"
      : "طلب داخلي";
