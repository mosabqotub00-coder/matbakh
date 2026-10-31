export const MATBAKH_WEB_MESSAGE_SOURCE = "matbakh-web";
export const MATBAKH_WEB_API_VERSION = 1;

export type MatbakhAuthChanged = {
  source: typeof MATBAKH_WEB_MESSAGE_SOURCE;
  type: "MATBAKH_AUTH_CHANGED";
  authenticated: boolean;
  passwordChangeRequired: boolean;
  apiVersion: typeof MATBAKH_WEB_API_VERSION;
};

export type MatbakhNativePushState = {
  source: typeof MATBAKH_WEB_MESSAGE_SOURCE;
  type: "MATBAKH_NATIVE_PUSH_STATE";
  registered: boolean;
  success: boolean;
  operation: "register" | "unregister" | "status" | "acknowledge" | "test";
  apiVersion: typeof MATBAKH_WEB_API_VERSION;
};

export type MatbakhNativePushTestRequest = {
  source: typeof MATBAKH_WEB_MESSAGE_SOURCE;
  type: "MATBAKH_NATIVE_PUSH_TEST_REQUEST";
  requestId?: string;
  apiVersion: typeof MATBAKH_WEB_API_VERSION;
};

export type MatbakhWebMessage = MatbakhAuthChanged | MatbakhNativePushState | MatbakhNativePushTestRequest;
export type NativePushOperation = "status" | "register" | "unregister" | "test" | "acknowledge";

export function parseMatbakhWebMessage(raw: unknown): MatbakhWebMessage | null {
  if (typeof raw !== "string" || raw.length > 12_000) return null;
  try {
    const message = JSON.parse(raw) as Record<string, unknown>;
    if (message.source !== MATBAKH_WEB_MESSAGE_SOURCE || message.apiVersion !== MATBAKH_WEB_API_VERSION) return null;

    if (message.type === "MATBAKH_AUTH_CHANGED") {
      if (typeof message.authenticated !== "boolean" || typeof message.passwordChangeRequired !== "boolean") return null;
      return message as MatbakhAuthChanged;
    }

    if (message.type === "MATBAKH_NATIVE_PUSH_STATE") {
      if (
        typeof message.registered !== "boolean" ||
        typeof message.success !== "boolean" ||
        !["register", "unregister", "status", "acknowledge", "test"].includes(String(message.operation))
      ) return null;
      return message as MatbakhNativePushState;
    }

    if (message.type === "MATBAKH_NATIVE_PUSH_TEST_REQUEST") {
      if (message.requestId !== undefined && typeof message.requestId !== "string") return null;
      return message as MatbakhNativePushTestRequest;
    }
    return null;
  } catch {
    return null;
  }
}

function encode(value: unknown) {
  return encodeURIComponent(JSON.stringify(value));
}

function callTprc(operation: NativePushOperation, input: Record<string, unknown>) {
  const envelope = JSON.stringify({ json: input });
  if (operation === "status") {
    const query = encodeURIComponent(envelope);
    return `fetch("/api/trpc/nativePush.status?input=${query}", { method: "GET", credentials: "include", headers: { "Accept": "application/json" } });`;
  }
  const body = encode({ 0: { json: input } });
  return `fetch("/api/trpc/nativePush.${operation}?batch=1", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: decodeURIComponent(${JSON.stringify(body)}) });`;
}

/**
 * Calls the existing site's tRPC from its own document context. The browser attaches
 * the site cookie; no token/cookie is read, copied, or sent through React Native fetch.
 */
export function createNativePushCallScript(operation: NativePushOperation, input: Record<string, unknown>) {
  const inputJson = encode(input);
  const statusCall = operation === "register"
    ? callTprc("status", { installationId: input.installationId })
    : null;
  const requestCall = callTprc(operation, input);
  return `(() => {
    const input = JSON.parse(decodeURIComponent(${JSON.stringify(inputJson)}));
    const notify = (registered, success, operation) => {
      window.__MATBAKH_NATIVE_PUSH_REGISTERED__ = registered;
      window.dispatchEvent(new CustomEvent("matbakh-native-push-state", { detail: { registered } }));
      try { window.ReactNativeWebView?.postMessage(JSON.stringify({
        source: "matbakh-web", type: "MATBAKH_NATIVE_PUSH_STATE", apiVersion: 1,
        registered, success, operation,
      })); } catch (_) {}
    };
    const unwrap = async (promise) => {
      const response = await promise;
      let body = null;
      try { body = await response.json(); } catch (_) {}
      const item = Array.isArray(body) ? body[0] : body;
      const success = response.ok && !!item && !item.error && !!item.result;
      const data = item?.result?.data?.json ?? item?.result?.data ?? null;
      return { success, data };
    };
    (async () => {
      try {
        ${statusCall ? `await unwrap(${statusCall});` : ""}
        const result = await unwrap(${requestCall});
        let registered = window.__MATBAKH_NATIVE_PUSH_REGISTERED__ === true;
        if (${JSON.stringify(operation)} === "register") registered = result.success;
        if (${JSON.stringify(operation)} === "unregister") registered = false;
        if (${JSON.stringify(operation)} === "status") {
          const state = result.data;
          if (typeof state?.registered === "boolean") registered = state.registered;
          else if (typeof state === "boolean") registered = state;
          else registered = result.success && registered;
        }
        notify(registered, result.success, ${JSON.stringify(operation)});
      } catch (_) {
        const registered = ${JSON.stringify(operation)} === "register" ? false : window.__MATBAKH_NATIVE_PUSH_REGISTERED__ === true;
        notify(${JSON.stringify(operation)} === "unregister" ? false : registered, false, ${JSON.stringify(operation)});
      }
    })();
    true;
  })();`;
}

export function createNativePushFlagScript(registered: boolean) {
  return `(() => {
    window.__MATBAKH_NATIVE_PUSH_REGISTERED__ = ${registered ? "true" : "false"};
    window.dispatchEvent(new CustomEvent("matbakh-native-push-state", { detail: { registered: ${registered ? "true" : "false"} } }));
    true;
  })();`;
}
