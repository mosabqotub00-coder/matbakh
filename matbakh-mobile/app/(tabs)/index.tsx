import Constants from "expo-constants";
import { AppState } from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Notifications from "expo-notifications";

import { MatbakhWebShell, type MatbakhWebShellHandle } from "@/components/matbakh-web-shell";
import { getInstallationId } from "@/lib/device-identity";
import { safeMatbakhTarget } from "@/lib/native-bridge";
import {
  consumeLaunchNotification,
  notificationTarget,
  requestMatbakhPushToken,
  subscribeToMatbakhPushEvents,
} from "@/lib/push-service";
import {
  INITIAL_SESSION_GATE,
  isCurrentAuthenticatedSession,
  transitionSessionGate,
} from "@/lib/session-gate";
import type { MatbakhWebMessage } from "@/lib/webview-contract";

function appVersion() {
  return Constants.expoConfig?.version ?? "1.0.0";
}

function deliveryId(notification: Notifications.Notification) {
  const value = (notification.request.content.data as Record<string, unknown>).deliveryId;
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export default function MatbakhScreen() {
  const shellRef = useRef<MatbakhWebShellHandle>(null);
  const pendingOpenedRef = useRef<Notifications.Notification | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const sessionGateRef = useRef(INITIAL_SESSION_GATE);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(INITIAL_SESSION_GATE.generation);

  useEffect(() => {
    void getInstallationId().then(setInstallationId).catch(() => setInstallationId(null));
  }, []);

  const hasActiveSession = useCallback(() => sessionGateRef.current.active, []);

  const syncDevice = useCallback(async (requestPermission = false) => {
    const capturedSession = sessionGateRef.current;
    if (!capturedSession.active || !installationId) return;

    try {
      const result = await requestMatbakhPushToken({ requestPermission });
      // Permission/token work may outlive a logout or a required password change.
      if (!isCurrentAuthenticatedSession(sessionGateRef.current, capturedSession)) return;

      if (result.state !== "ready") {
        shellRef.current?.setPushRegistered(false);
        shellRef.current?.unregisterDevice(installationId);
        return;
      }

      shellRef.current?.registerDevice({
        installationId,
        expoPushToken: result.expoPushToken,
        platform: "android",
        appVersion: appVersion(),
      });
    } catch {
      if (!isCurrentAuthenticatedSession(sessionGateRef.current, capturedSession)) return;
      shellRef.current?.setPushRegistered(false);
      shellRef.current?.unregisterDevice(installationId);
    }
  }, [installationId]);

  useEffect(() => {
    if (hasActiveSession()) void syncDevice(true);
  }, [hasActiveSession, installationId, sessionGeneration, syncDevice]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && hasActiveSession()) void syncDevice(false);
    });
    return () => subscription.remove();
  }, [hasActiveSession, syncDevice]);

  const acknowledgeOpened = useCallback(() => {
    const notification = pendingOpenedRef.current;
    const id = installationId;
    const loadedTarget = loadedUrlRef.current ? safeMatbakhTarget(loadedUrlRef.current) : null;
    if (!notification || !id || !loadedTarget || !hasActiveSession()) return;

    const expectedTarget = notificationTarget(notification);
    if (loadedTarget.path !== expectedTarget.path) return;
    const delivery = deliveryId(notification);
    if (delivery === null) return;

    shellRef.current?.acknowledgePush({ installationId: id, deliveryId: delivery, state: "opened" });
    pendingOpenedRef.current = null;
  }, [hasActiveSession, installationId]);

  const dispatchOpened = useCallback((notification: Notifications.Notification) => {
    pendingOpenedRef.current = notification;
    shellRef.current?.navigate(notificationTarget(notification));
    acknowledgeOpened();
  }, [acknowledgeOpened]);

  const onPageReady = useCallback((url: string) => {
    loadedUrlRef.current = url;
    acknowledgeOpened();
  }, [acknowledgeOpened]);

  useEffect(() => {
    acknowledgeOpened();
  }, [acknowledgeOpened]);

  useEffect(() => {
    const initialNotification = consumeLaunchNotification();
    if (initialNotification) dispatchOpened(initialNotification);
    return subscribeToMatbakhPushEvents({
      onReceived(notification) {
        const id = installationId;
        const delivery = deliveryId(notification);
        if (!id || delivery === null || !hasActiveSession()) return;
        shellRef.current?.acknowledgePush({ installationId: id, deliveryId: delivery, state: "received" });
      },
      onOpened: dispatchOpened,
    });
  }, [dispatchOpened, hasActiveSession, installationId]);

  const onWebMessage = useCallback((message: MatbakhWebMessage) => {
    if (message.type === "MATBAKH_AUTH_CHANGED") {
      const active = message.authenticated && !message.passwordChangeRequired;
      const nextGate = transitionSessionGate(sessionGateRef.current, active);
      sessionGateRef.current = nextGate;
      setSessionGeneration(nextGate.generation);

      if (!active) {
        shellRef.current?.setPushRegistered(false);
        if (installationId) shellRef.current?.unregisterDevice(installationId);
      }
      return;
    }

    if (message.type === "MATBAKH_NATIVE_PUSH_STATE") {
      shellRef.current?.setPushRegistered(message.registered && hasActiveSession());
      return;
    }

    if (message.type === "MATBAKH_NATIVE_PUSH_TEST_REQUEST" && installationId && hasActiveSession()) {
      shellRef.current?.testPush(installationId);
    }
  }, [hasActiveSession, installationId]);

  return <MatbakhWebShell ref={shellRef} onWebMessage={onWebMessage} onPageReady={onPageReady} />;
}
