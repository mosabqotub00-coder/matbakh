import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { unlockKitchenAudio } from "@/lib/kitchen-audio";

const STORAGE_KEY = "matbakh.audio-announcements-enabled";

type KitchenAudioContextValue = {
  enabled: boolean;
  toggle: () => void;
};

const KitchenAudioContext = createContext<KitchenAudioContextValue | null>(null);

function readStoredPreference() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function KitchenAudioProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(readStoredPreference);

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Keep the current-tab preference even if storage is unavailable.
    }
    if (next) {
      unlockKitchenAudio();
    } else if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, [enabled]);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setEnabled(event.newValue === "true");
      if (event.newValue !== "true" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  return <KitchenAudioContext.Provider value={{ enabled, toggle }}>{children}</KitchenAudioContext.Provider>;
}

export function useKitchenAudio() {
  const context = useContext(KitchenAudioContext);
  if (!context) throw new Error("useKitchenAudio must be used inside KitchenAudioProvider");
  return context;
}
