"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getPreferredVoice, voiceTier, type VoiceTier } from "@/lib/audio/tts";
import { mutedTextXs } from "@/lib/utils/class-names";

const DISMISS_KEY = "poke-memory:settings:voice-tip:v1";

export function VoiceQualityHint() {
  const t = useTranslations("settings.audio.voiceQualityHint");

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
          <p className="text-sm font-medium text-foreground">{t("heading")}</p>
          <p className={`mt-1 ${mutedTextXs}`}>
            {t("body")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, "1");
            setDismissed(true);
          }}
          aria-label={t("dismissAriaLabel")}
          className="shrink-0 rounded text-zinc-400 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 dark:hover:text-zinc-200"
        >
          ×
        </button>
      </div>
    </div>
  );
}
