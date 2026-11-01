// Site address the app opens; override at build time with EXPO_PUBLIC_MATBAKH_URL (HTTPS origin only).
const DEFAULT_MATBAKH_URL = "https://www.matbakh.click";
export const MATBAKH_ORIGIN = new URL(process.env.EXPO_PUBLIC_MATBAKH_URL?.trim() || DEFAULT_MATBAKH_URL).origin;
export const MATBAKH_HOSTS = new Set([new URL(MATBAKH_ORIGIN).hostname.toLowerCase(), "matbakh.click", "www.matbakh.click"]);
export const MATBAKH_ORIGIN_WHITELIST = Array.from(MATBAKH_HOSTS, (host) => `https://${host}/*`);

// Notification deep links are restricted to the operational routes confirmed by the site owner.
const ALLOWED_PATHS = new Set(["/", "/kitchen", "/manager", "/notifications"]);

export type SafeMatbakhTarget = { url: string; path: string };

/** Canonicalize and validate a same-origin operational target before Native navigation. */
export function safeMatbakhTarget(value: unknown): SafeMatbakhTarget | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value, MATBAKH_ORIGIN);
    if (url.protocol !== "https:" || !MATBAKH_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.port || url.username || url.password || !ALLOWED_PATHS.has(url.pathname)) return null;
    return {
      url: `${MATBAKH_ORIGIN}${url.pathname}${url.search}${url.hash}`,
      path: `${url.pathname}${url.search}${url.hash}`,
    };
  } catch {
    return null;
  }
}

/** Internal WebView navigation may cover the complete site, but never another origin. */
export function isMatbakhWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && MATBAKH_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type NativeDevicePayload = {
  installationId: string;
  expoPushToken: string;
  platform: "android";
  appVersion?: string;
};
