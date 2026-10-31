import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { SafeMatbakhTarget } from "@/lib/native-bridge";
import { notificationTargetFromData } from "@/lib/notification-routing";

export const MATBAKH_NOTIFICATION_CHANNEL = "matbakh-orders-v1";

// The site suppresses its beep while native registration is active; Android owns the one alert.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type PushRegistration =
  | { state: "ready"; expoPushToken: string }
  | { state: "denied"; reason: "permission" | "project-id" | "token" };

function getEasProjectId() {
  const eas = Constants.expoConfig?.extra?.eas as { projectId?: unknown } | undefined;
  const configured = eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof configured === "string" && configured.trim() ? configured : null;
}

export async function requestMatbakhPushToken(options: { requestPermission?: boolean } = {}): Promise<PushRegistration> {
  if (Platform.OS !== "android") return { state: "denied", reason: "token" };

  await Notifications.setNotificationChannelAsync(MATBAKH_NOTIFICATION_CHANNEL, {
    name: "طلبات مطبخي",
    description: "تنبيهات السخان والمطبخ المهمة",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 180, 250],
    lightColor: "#C97A40",
    sound: "default",
    enableVibrate: true,
    showBadge: true,
  });

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === "granted" || options.requestPermission === false
    ? current
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") return { state: "denied", reason: "permission" };

  const projectId = getEasProjectId();
  if (!projectId) return { state: "denied", reason: "project-id" };

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return { state: "ready", expoPushToken: token.data };
  } catch {
    return { state: "denied", reason: "token" };
  }
}

export function notificationTarget(notification: Notifications.Notification): SafeMatbakhTarget {
  return notificationTargetFromData(notification.request.content.data);
}

export function consumeLaunchNotification() {
  const response = Notifications.getLastNotificationResponse();
  if (!response) return null;
  Notifications.clearLastNotificationResponse();
  return response.notification;
}

export function subscribeToMatbakhPushEvents(options: {
  onReceived: (notification: Notifications.Notification) => void;
  onOpened: (notification: Notifications.Notification) => void;
}) {
  const received = Notifications.addNotificationReceivedListener(options.onReceived);
  const opened = Notifications.addNotificationResponseReceivedListener((response) => {
    options.onOpened(response.notification);
    Notifications.clearLastNotificationResponse();
  });
  return () => {
    received.remove();
    opened.remove();
  };
}
