import { describe, expect, it, vi } from "vitest";
import {
  BROADCAST_MAX_BYTES,
  createWavHeader,
  pcmToFloat,
  validateAudioPacket,
} from "../shared/broadcast-audio";

vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./notifications", () => ({ emitNotification: vi.fn() }));

import { canReadBroadcast } from "./communications";

describe("recorded live PCM audio", () => {
  it("creates a valid WAV header for mono PCM16 at 16kHz", () => {
    const bytes = createWavHeader(32000);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(32036);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(32000);
  });
  it("rejects oversized, empty, or half-sample packets", () => {
    expect(() => validateAudioPacket(new Uint8Array())).toThrow();
    expect(() => validateAudioPacket(new Uint8Array(3))).toThrow();
    expect(() => validateAudioPacket(new Uint8Array(32002))).toThrow();
    expect(() => createWavHeader(BROADCAST_MAX_BYTES + 2)).toThrow();
    expect(() => validateAudioPacket(new Uint8Array(16000))).not.toThrow();
  });
  it("converts little-endian samples independently of buffer offsets", () => {
    const source = new Uint8Array([99, 0, 128, 255, 127]);
    const samples = pcmToFloat(source.subarray(1));
    expect(samples[0]).toBe(-1);
    expect(samples[1]).toBeCloseTo(1, 3);
  });
});

describe("broadcast branch and receiver permissions", () => {
  const target = { branchId: 2, targetSection: "kitchen" as const };
  it("isolates other branches even for kitchen managers", () => {
    expect(
      canReadBroadcast({ role: "kitchen_manager", branchId: 1 }, target)
    ).toBe(false);
    expect(
      canReadBroadcast({ role: "kitchen_manager", branchId: 2 }, target)
    ).toBe(true);
  });
  it("isolates station receivers from kitchen audio", () => {
    expect(canReadBroadcast({ role: "station", branchId: 2 }, target)).toBe(
      false
    );
    expect(canReadBroadcast({ role: "kitchen", branchId: 2 }, target)).toBe(
      true
    );
  });
  it("allows the system administrator across branches", () => {
    expect(
      canReadBroadcast({ role: "system_admin", branchId: null }, target)
    ).toBe(true);
  });
});
