import { safeMatbakhTarget, type SafeMatbakhTarget } from "./native-bridge";

export type MatbakhPushData = Record<string, unknown>;

/** Validates server-provided notification navigation before the Native shell opens it. */
export function notificationTargetFromData(value: unknown): SafeMatbakhTarget {
  const data = value && typeof value === "object" ? value as MatbakhPushData : {};
  const direct = safeMatbakhTarget(data.url);
  if (direct) return direct;
  if (data.targetSection === "kitchen") return safeMatbakhTarget("/kitchen")!;
  if (data.targetSection === "station" || data.targetSection === "heater") return safeMatbakhTarget("/")!;
  return safeMatbakhTarget("/notifications")!;
}
