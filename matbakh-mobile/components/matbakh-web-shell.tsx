import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

import { createNativePushCallScript, createNativePushFlagScript, parseMatbakhWebMessage, type MatbakhWebMessage } from "@/lib/webview-contract";
import { isMatbakhWebUrl, MATBAKH_ORIGIN, MATBAKH_ORIGIN_WHITELIST, safeMatbakhTarget, type NativeDevicePayload, type SafeMatbakhTarget } from "@/lib/native-bridge";

// react-native-webview's conditional native props resolve to `never` in this Expo/React pair.
const TypedWebView = WebView as unknown as React.ComponentType<any>;

export type MatbakhWebShellHandle = {
  reload: () => void;
  navigate: (target: SafeMatbakhTarget) => void;
  registerDevice: (payload: NativeDevicePayload) => void;
  unregisterDevice: (installationId: string) => void;
  testPush: (installationId: string) => void;
  acknowledgePush: (payload: { installationId: string; deliveryId: string | number; state: "received" | "opened" }) => void;
  setPushRegistered: (registered: boolean) => void;
};

type Props = {
  onWebMessage: (message: MatbakhWebMessage) => void;
  onPageReady: (url: string) => void;
};

export const MatbakhWebShell = forwardRef<MatbakhWebShellHandle, Props>(function MatbakhWebShell(
  { onWebMessage, onPageReady },
  ref,
) {
  const webRef = useRef<any>(null);
  const loadedRef = useRef(false);
  const canGoBackRef = useRef(false);
  const [sourceUrl, setSourceUrl] = useState(`${MATBAKH_ORIGIN}/`);
  const [isLoading, setIsLoading] = useState(true);
  const [networkIssue, setNetworkIssue] = useState(false);

  useImperativeHandle(ref, () => ({
    reload() {
      setNetworkIssue(false);
      setIsLoading(true);
      webRef.current?.reload();
    },
    navigate(target) {
      setNetworkIssue(false);
      if (!loadedRef.current) {
        setSourceUrl(target.url);
        return;
      }
      webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(target.url)}); true;`);
    },
    registerDevice(payload) {
      webRef.current?.injectJavaScript(createNativePushCallScript("register", payload as unknown as Record<string, unknown>));
    },
    unregisterDevice(installationId) {
      webRef.current?.injectJavaScript(createNativePushCallScript("unregister", { installationId }));
    },
    testPush(installationId) {
      webRef.current?.injectJavaScript(createNativePushCallScript("test", { installationId }));
    },
    acknowledgePush(payload) {
      webRef.current?.injectJavaScript(createNativePushCallScript("acknowledge", payload));
    },
    setPushRegistered(registered) {
      webRef.current?.injectJavaScript(createNativePushFlagScript(registered));
    },
  }));

  const onMessage = (event: WebViewMessageEvent) => {
    if (!isMatbakhWebUrl(event.nativeEvent.url)) return;
    const message = parseMatbakhWebMessage(event.nativeEvent.data);
    if (!message) return;
    onWebMessage(message);
  };

  const onShouldStartLoadWithRequest = (request: WebViewNavigation) => {
    if (isMatbakhWebUrl(request.url)) return true;
    if (/^(https?:|mailto:|tel:)/i.test(request.url)) {
      void Linking.openURL(request.url).catch(() => undefined);
    }
    return false;
  };

  const onNavigationStateChange = (state: WebViewNavigation) => {
    canGoBackRef.current = state.canGoBack;
    if (isMatbakhWebUrl(state.url)) {
      const target = safeMatbakhTarget(state.url);
      if (target) setSourceUrl(target.url);
    }
  };

  const onLoadEnd = (event: { nativeEvent?: { url?: string } }) => {
    loadedRef.current = true;
    setIsLoading(false);
    onPageReady(event.nativeEvent?.url ?? sourceUrl);
  };

  return (
    <View style={styles.root}>
      <TypedWebView
        ref={webRef}
        source={{ uri: sourceUrl }}
        originWhitelist={MATBAKH_ORIGIN_WHITELIST}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={() => {
          loadedRef.current = false;
          setIsLoading(true);
        }}
        onLoadEnd={onLoadEnd}
        onError={() => {
          setIsLoading(false);
          setNetworkIssue(true);
        }}
        onHttpError={(event: { nativeEvent: { statusCode: number } }) => {
          if (event.nativeEvent.statusCode >= 500) setNetworkIssue(true);
        }}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        mixedContentMode="never"
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="prompt"
        pullToRefreshEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading} accessibilityLabel="جارٍ تحميل مطبخي">
            <ActivityIndicator color="#C97A40" />
            <Text style={styles.loadingText}>جارٍ فتح مطبخي…</Text>
          </View>
        )}
      />
    <BackHandlerBridge canGoBackRef={canGoBackRef} webRef={webRef} />
      {networkIssue ? (
        <View style={styles.networkCard} accessibilityLiveRegion="polite">
          <Text style={styles.networkTitle}>تعذّر الوصول إلى مطبخي</Text>
          <Text style={styles.networkBody}>تحقّق من اتصال الإنترنت ثم أعد المحاولة.</Text>
          <Pressable
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={() => {
              setNetworkIssue(false);
              setIsLoading(true);
              webRef.current?.reload();
            }}
          >
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : null}
      {isLoading && !networkIssue ? <View pointerEvents="none" style={styles.topProgress} /> : null}
    </View>
  );
});

function BackHandlerBridge({
  canGoBackRef,
  webRef,
}: {
  canGoBackRef: React.MutableRefObject<boolean>;
  webRef: React.RefObject<any>;
}) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBackRef.current) return false;
      webRef.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBackRef, webRef]);
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D1211" },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#0D1211" },
  loadingText: { color: "#F4ECE5", fontSize: 15, writingDirection: "rtl" },
  topProgress: { position: "absolute", top: 0, right: 0, left: 0, height: 3, backgroundColor: "#C97A40" },
  networkCard: { position: "absolute", right: 18, left: 18, bottom: 28, backgroundColor: "#18211F", borderColor: "#C97A40", borderWidth: 1, borderRadius: 18, padding: 16, alignItems: "flex-start", gap: 8, elevation: 8 },
  networkTitle: { color: "#FFF7F0", fontSize: 17, fontWeight: "700", writingDirection: "rtl" },
  networkBody: { color: "#D7C8BD", fontSize: 14, lineHeight: 20, writingDirection: "rtl" },
  retryButton: { alignSelf: "stretch", minHeight: 48, backgroundColor: "#C97A40", borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  retryText: { color: "#17100C", fontSize: 15, fontWeight: "800", writingDirection: "rtl" },
});
