import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let state: string;
let constructors: number;
const speak = vi.fn();
const speechCancel = vi.fn();
beforeEach(() => {
  vi.resetModules();
  constructors = 0;
  state = "running";
  speak.mockClear();
  speechCancel.mockClear();
  const parameter = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  class TestContext {
    constructor() {
      constructors++;
    }
    get state() {
      return state;
    }
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => {});
    createOscillator = () => ({
      type: "sine",
      frequency: parameter(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    });
    createGain = () => ({
      gain: parameter(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
  }
  vi.stubGlobal("window", {
    AudioContext: TestContext,
    localStorage: { getItem: () => "true" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speechSynthesis: {
      resume: vi.fn(),
      speak,
      cancel: speechCancel,
      getVoices: () => [],
    },
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("browser audio readiness", () => {
  it("does not consume speech before a user interaction", async () => {
    const audio = await import("../client/src/lib/kitchen-audio");
    expect(audio.speakKitchenAnnouncement("طلب جديد")).toBe(false);
    expect(speak).not.toHaveBeenCalled();
    audio.unlockKitchenAudio();
    expect(audio.speakKitchenAnnouncement("طلب جديد")).toBe(true);
    expect(speak).toHaveBeenCalledOnce();
  });
  it("does not claim a tone played while its context is suspended", async () => {
    state = "suspended";
    const audio = await import("../client/src/lib/kitchen-audio");
    expect(audio.playOverdueAlert()).toBe(false);
  });
  it("reuses one running context and supports urgent speech interruption", async () => {
    const audio = await import("../client/src/lib/kitchen-audio");
    audio.unlockKitchenAudio();
    expect(audio.playOverdueAlert()).toBe(true);
    expect(audio.playOverdueAlert()).toBe(true);
    expect(constructors).toBe(1);
    expect(audio.speakKitchenAnnouncement("طلب متأخر", true)).toBe(true);
    expect(speechCancel).toHaveBeenCalledOnce();
  });
});

describe("spoken kitchen notes", () => {
  it("queues the actual full note in the browser utterance", async () => {
    const audio = await import("../client/src/lib/kitchen-audio");
    const { orderAnnouncementText } = await import(
      "../client/src/lib/kitchen-ui"
    );
    audio.unlockKitchenAudio();
    const text = orderAnnouncementText({
      id: 1,
      orderCode: "S-DRBXCZ",
      status: "new",
      createdAt: "2026-10-27T12:00:00Z",
      items: [{ id: 1, productName: "كرسبي", quantity: 2, prepMinutes: 10 }],
      notes: "بدون ملح والصوص منفصل",
    });
    expect(audio.speakKitchenAnnouncement(text)).toBe(true);
    expect(speak.mock.calls[0][0].text).toBe(text);
    expect(speak.mock.calls[0][0].text).toContain(
      "ملاحظات المطبخ: بدون ملح والصوص منفصل"
    );
    expect(speak.mock.calls[0][0].text).not.toContain("S-DRBXCZ");
  });
});
