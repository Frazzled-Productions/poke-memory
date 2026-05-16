"use client";

import { useEffect, useState } from "react";
import { getPreferredVoice, voiceTier, type VoiceTier } from "@/lib/audio/tts";

const DISMISS_KEY = "poke-memory:settings:voice-tip:v1";

export function VoiceQualityHint() {
  const [tier, setTier] = useState<VoiceTier | "unknown">("unknown");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");

    const update = (): void => {
      const v = getPreferredVoice();
      if (v === null) return;
      setTier(voiceTier(v));
    };
    update();

    if ("speechSynthesis" in window) {
      const synth = window.speechSynthesis;
      synth.addEventListener("voiceschanged", update);
      return () => synth.removeEventListener("voiceschanged", update);
    }
    return;
  }, []);

  if (dismissed || tier !== "compact") return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">Voice sounding robotic?</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            The default English voice on most devices is a low-quality &ldquo;compact&rdquo; version. Your device&apos;s accessibility or spoken-content settings let you download a higher-quality (Premium or Enhanced) British English voice. Once installed, the app picks it automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          aria-label="Dismiss tip"
          className="shrink-0 rounded text-zinc-400 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>
    </div>
  );
}
