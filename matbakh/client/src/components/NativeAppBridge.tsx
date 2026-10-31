import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

type NativeWindow = Window & { ReactNativeWebView?: { postMessage: (data: string) => void } };

/** Tells the Android app shell (WebView) when the staff session changes so it can bind push. */
export default function NativeAppBridge() {
  const session = trpc.auth.me.useQuery(undefined, { retry: false });
  const user = session.data as { id?: number; mustChangePassword?: boolean } | null | undefined;
  const authenticated = Boolean(user?.id);
  const passwordChangeRequired = Boolean(user?.mustChangePassword);
  const ready = !session.isLoading;

  useEffect(() => {
    const bridge = (window as NativeWindow).ReactNativeWebView;
    if (!ready || !bridge) return;
    bridge.postMessage(JSON.stringify({
      source: "matbakh-web",
      type: "MATBAKH_AUTH_CHANGED",
      authenticated: authenticated && !passwordChangeRequired,
      passwordChangeRequired,
      apiVersion: 1,
    }));
  }, [ready, authenticated, passwordChangeRequired, user?.id]);

  return null;
}
