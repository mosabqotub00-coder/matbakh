import { useRef } from "react";

import { MatbakhWebShell, type MatbakhWebShellHandle } from "@/components/matbakh-web-shell";
import type { MatbakhWebMessage } from "@/lib/webview-contract";

/** Web Preview is intentionally limited to the real site wrapper; Android Push is native-only. */
export default function MatbakhWebPreview() {
  const shellRef = useRef<MatbakhWebShellHandle>(null);

  const onWebMessage = (_message: MatbakhWebMessage) => {
    // The browser preview has no device token, notification channel, or secure native storage.
  };

  return <MatbakhWebShell ref={shellRef} onWebMessage={onWebMessage} onPageReady={(_url) => undefined} />;
}
