"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { speakName } from "@/lib/audio/tts";
import { cardPanelPadded, colStackLg, mutedTextXs } from "@/lib/utils/class-names";

type TtsControlsProps = {
  ttsVoice: string | null;
  ttsRate: number;
  ttsVolume: number;
  onChange: (patch: { ttsVoice?: string | null; ttsRate?: number; ttsVolume?: number }) => void;
};

export function TtsControls({ ttsVoice, ttsRate, ttsVolume, onChange }: TtsControlsProps) {
  const t = useTranslations("settings.audio.ttsControls");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const synth = window.speechSynthesis;

    function load() {
      const all = synth.getVoices();
      const english = all.filter((v) => v.lang.startsWith("en"));
      setVoices(english);
    }

    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, []);

  function handlePreview() {
    speakName("Bulbasaur", null, { ttsVoice, ttsRate, ttsVolume });
  }

  return (
    <div className={colStackLg}>
      {/* Voice picker */}
      <div className={cardPanelPadded}>
        <label
          htmlFor="tts-voice"
          className="block text-sm font-medium text-foreground"
        >
          {t("voiceLabel")}
        </label>
        <select
          id="tts-voice"
          value={ttsVoice ?? ""}
          onChange={(e) => onChange({ ttsVoice: e.target.value === "" ? null : e.target.value })}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
        >
          <option value="">{t("voiceAutoOption")}</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        <p className={`mt-1 ${mutedTextXs}`}>
          {t("voiceHint")}
        </p>
      </div>

      {/* Rate slider */}
      <div className={cardPanelPadded}>
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="tts-rate"
            className="block text-sm font-medium text-foreground"
          >
            {t("rateLabel", { rate: ttsRate.toFixed(1) })}
          </label>
          <button
            type="button"
            onClick={handlePreview}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {t("hearSample")}
          </button>
        </div>
        <input
          id="tts-rate"
          type="range"
          min={0.5}
          max={2.0}
          step={0.1}
          value={ttsRate}
          onChange={(e) => onChange({ ttsRate: Number(e.target.value) })}
          className="mt-3 w-full"
        />
        <div className="mt-1 flex justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>{t("rateSlow")}</span>
          <span>{t("rateFast")}</span>
        </div>
      </div>

      {/* Volume slider */}
      <div className={cardPanelPadded}>
        <label
          htmlFor="tts-volume"
          className="block text-sm font-medium text-foreground"
        >
          {t("volumeLabel", { pct: Math.round(ttsVolume * 100) })}
        </label>
        <input
          id="tts-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ttsVolume}
          onChange={(e) => onChange({ ttsVolume: Number(e.target.value) })}
          className="mt-3 w-full"
        />
        <div className="mt-1 flex justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>{t("volumeMute")}</span>
          <span>{t("volumeFull")}</span>
        </div>
      </div>
    </div>
  );
}
