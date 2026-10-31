import { createElement, forwardRef, useImperativeHandle, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { MATBAKH_ORIGIN, type NativeDevicePayload, type SafeMatbakhTarget } from "@/lib/native-bridge";
import type { MatbakhWebShellHandle } from "./matbakh-web-shell";
import type { MatbakhWebMessage } from "@/lib/webview-contract";

type Props = {
  onWebMessage: (message: MatbakhWebMessage) => void;
  onPageReady: (url: string) => void;
};

/** Browser Preview renders the real published site; it deliberately does not simulate Android APIs. */
export const MatbakhWebShell = forwardRef<MatbakhWebShellHandle, Props>(function MatbakhWebShellWeb(
  _props,
  ref,
) {
  const [src, setSrc] = useState(`${MATBAKH_ORIGIN}/`);
  const [reloadKey, setReloadKey] = useState(0);
  useImperativeHandle(ref, () => ({
    reload() { setReloadKey((value) => value + 1); },
    navigate(target: SafeMatbakhTarget) { setSrc(target.url); },
    registerDevice(_payload: NativeDevicePayload) {},
    unregisterDevice(_installationId: string) {},
    testPush(_installationId: string) {},
    acknowledgePush(_payload) {},
    setPushRegistered(_registered: boolean) {},
  }));

  const iframe = createElement("iframe", {
    key: reloadKey,
    src,
    title: "موقع مطبخي",
    allow: "microphone",
    referrerPolicy: "strict-origin-when-cross-origin",
    onLoad: () => _props.onPageReady(src),
    style: { border: 0, width: "100%", height: "100%", display: "block", background: "#0D1211" },
  });

  return (
    <View style={styles.root}>
      <View style={styles.notice}>
        <Text style={styles.noticeText}>معاينة الويب تعرض الموقع المنشور؛ لا تختبر إشعارات Android.</Text>
        <Pressable onPress={() => void Linking.openURL(MATBAKH_ORIGIN)} accessibilityRole="link">
          <Text style={styles.link}>فتح الموقع</Text>
        </Pressable>
      </View>
      <View style={styles.frame}>{iframe}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0D1211" },
  notice: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#18211F", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  noticeText: { flex: 1, color: "#F4ECE5", fontSize: 12, textAlign: "right", writingDirection: "rtl" },
  link: { color: "#E6A56C", fontSize: 13, fontWeight: "700" },
  frame: { flex: 1, overflow: "hidden" },
});
