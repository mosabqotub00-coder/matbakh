import type { SafeMatbakhTarget } from "./native-bridge";
import { notificationTargetFromData } from "./notification-routing";

export const MATBAKH_NOTIFICATION_CHANNEL = "matbakh-orders-v1";

type BrowserNotification = { request: { content: { data: Record<string, unknown> } } };

type PushRegistration =
  | { state: "ready"; expoPushToken: string }
  | { state: "denied"; reason: "permission" | "project-id" | "token" };

/** Web Preview intentionally has no Android push implementation. */
export async function requestMatbakhPushToken(): Promise<PushRegistration> {
  return { state: "denied", reason: "token" };
}

export function notificationTarget(notification: BrowserNotification): SafeMatbakhTarget {
  return notificationTargetFromData(notification.request.content.data);
}

export function consumeLaunchNotification(): null {
  return null;
}

export function subscribeToMatbakhPushEvents(_options: {
  onReceived: (notification: BrowserNotification) => void;
  onOpened: (notification: BrowserNotification) => void;
}) {
  return () => {};
}
