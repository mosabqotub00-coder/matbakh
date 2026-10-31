import { describe, expect, it } from "vitest";
import {
  parseOrderIds,
  persistOrderIds,
  unannouncedOrderIds,
} from "../client/src/lib/order-announcements";

describe("order announcement IDs", () => {
  it("keeps visual and audio sets independent for arrivals while muted", () => {
    const visualIds = new Set<number>();
    const audioIds = new Set<number>();

    visualIds.add(41);

    expect(unannouncedOrderIds([41], visualIds)).toEqual([]);
    expect(unannouncedOrderIds([41], audioIds)).toEqual([41]);
  });

  it("allows a muted arrival to be announced once after audio is enabled", () => {
    const audioIds = new Set<number>();

    expect(unannouncedOrderIds([7], audioIds)).toEqual([7]);
    audioIds.add(7);
    expect(unannouncedOrderIds([7], audioIds)).toEqual([]);
  });

  it("accepts only positive integer IDs from persisted storage", () => {
    expect(parseOrderIds(JSON.stringify([1, 0, -2, 2.5, "3", 4]))).toEqual(
      new Set([1, 4])
    );
    expect(parseOrderIds("not-json")).toEqual(new Set());
  });

  it("persists only IDs explicitly committed after audio invocation", () => {
    const values = new Map<string, string>();
    const storage = {
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    const audioIds = new Set<number>();

    expect(values.has("audio")).toBe(false);
    audioIds.add(9);
    persistOrderIds(audioIds, storage, "audio");

    expect(JSON.parse(values.get("audio") ?? "[]")).toEqual([9]);
  });
});
