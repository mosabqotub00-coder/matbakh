import { describe, expect, it } from "vitest";
import { isMatbakhWebUrl, safeMatbakhTarget, MATBAKH_ORIGIN } from "../lib/native-bridge";

describe("Matbakh Native URL boundary", () => {
  it("accepts only HTTPS on the site's exact hosts for normal WebView navigation", () => {
    expect(isMatbakhWebUrl("https://matbakh.click/kitchen")).toBe(true);
    expect(isMatbakhWebUrl("https://www.matbakh.click/notifications")).toBe(true);
    expect(isMatbakhWebUrl("http://matbakh.click/")).toBe(false);
    expect(isMatbakhWebUrl("https://matbakh.click.evil.example/")).toBe(false);
    expect(isMatbakhWebUrl("https://matbakh.click:9443/")).toBe(false);
    expect(isMatbakhWebUrl("javascript:alert(1)")).toBe(false);
  });

  it("preserves query identity on a confirmed notification route", () => {
    expect(safeMatbakhTarget("/notifications?notificationId=4&branchId=2")).toEqual({
      url: `${MATBAKH_ORIGIN}/notifications?notificationId=4&branchId=2`,
      path: "/notifications?notificationId=4&branchId=2",
    });
    expect(safeMatbakhTarget("https://www.matbakh.click/manager?section=staff")?.path)
      .toBe("/manager?section=staff");
  });

  it.each([
    "https://evil.example/kitchen",
    "https://matbakh.click:9443/kitchen",
    "javascript:alert(1)",
    "https://matbakh.click/login",
    "https://matbakh.click/manager/users",
    "https://user@matbakh.click/kitchen",
    "//evil.example/kitchen",
    "",
  ])("rejects an unsafe or unconfirmed Native target: %s", (candidate) => {
    expect(safeMatbakhTarget(candidate)).toBeNull();
  });
});
