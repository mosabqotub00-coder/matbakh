const AUDIO_PREFERENCE_STORAGE_KEY = "matbakh.audio-announcements-enabled";

type BrowserWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioContext: AudioContext | null = null;
let persistedUnlockListenerInstalled = false;
let audioInteractionUnlocked = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext || (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext || audioContext.state === "closed")
      audioContext = new AudioContextClass();
    if (audioContext.state === "suspended")
      void audioContext.resume().catch(() => undefined);
    return audioContext;
  } catch {
    return null;
  }
}

function resumeSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      void window.speechSynthesis.resume();
    } catch {
      // Browsers can block speech until an explicit user interaction.
    }
  }
}

function unlockFromInteraction() {
  audioInteractionUnlocked = true;
  getAudioContext();
  resumeSpeech();
  window.removeEventListener("pointerdown", unlockFromInteraction);
  window.removeEventListener("keydown", unlockFromInteraction);
  window.removeEventListener("touchstart", unlockFromInteraction);
  persistedUnlockListenerInstalled = false;
}

/**
 * If audio was enabled before a reload, wait for the first real user gesture
 * before resuming the shared audio context. This avoids creating a context per
 * alert and satisfies autoplay policies without playing a surprise alert.
 */
export function registerKitchenAudioUnlockListener() {
  if (typeof window === "undefined" || persistedUnlockListenerInstalled) return;
  try {
    if (window.localStorage.getItem(AUDIO_PREFERENCE_STORAGE_KEY) !== "true")
      return;
  } catch {
    return;
  }
  persistedUnlockListenerInstalled = true;
  window.addEventListener("pointerdown", unlockFromInteraction, { once: true });
  window.addEventListener("keydown", unlockFromInteraction, { once: true });
  window.addEventListener("touchstart", unlockFromInteraction, { once: true });
}

function createTone(
  type: OscillatorType,
  configure: (
    oscillator: OscillatorNode,
    gain: GainNode,
    start: number
  ) => void,
  duration: number
): boolean {
  const context = getAudioContext();
  if (!context || context.state !== "running") return false;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = type;
    configure(oscillator, gain, start);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + duration);
    return true;
  } catch {
    return false;
  }
}

export function playKitchenAlert(): boolean {
  return createTone(
    "sine",
    (oscillator, gain, start) => {
      oscillator.frequency.setValueAtTime(880, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    },
    0.52
  );
}

export function playOverdueAlert(): boolean {
  return createTone(
    "triangle",
    (oscillator, gain, start) => {
      oscillator.frequency.setValueAtTime(1046, start);
      oscillator.frequency.setValueAtTime(880, start + 0.2);
      gain.gain.setValueAtTime(0.0001, start);
      for (const pulse of [0, 0.24, 0.48]) {
        gain.gain.setValueAtTime(0.0001, start + pulse);
        gain.gain.exponentialRampToValueAtTime(0.35, start + pulse + 0.025);
        gain.gain.setValueAtTime(0.35, start + pulse + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + pulse + 0.19);
      }
    },
    0.7
  );
}

export function unlockKitchenAudio() {
  audioInteractionUnlocked = true;
  playKitchenAlert();
  resumeSpeech();
}

export function speakKitchenAnnouncement(
  message: string,
  interrupt = false
): boolean {
  if (
    !audioInteractionUnlocked ||
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  )
    return false;
  try {
    const speech = window.speechSynthesis;
    if (interrupt) speech.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "ar-SA";
    utterance.rate = 0.95;
    const arabicVoice = speech
      .getVoices()
      .find(voice => voice.lang.toLowerCase().startsWith("ar"));
    if (arabicVoice) utterance.voice = arabicVoice;
    speech.resume();
    speech.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") registerKitchenAudioUnlockListener();
