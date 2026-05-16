"use client";

import { useEffect, useState } from "react";
import { speakName } from "@/lib/audio/tts";

type TtsControlsProps = {
  ttsVoice: string | null;
  ttsRate: number;
  ttsVolume: number;
  onChange: (patch: { ttsVoice?: string | null; ttsRate?: number; ttsVolume?: number }) => void;
};

export function TtsControls({ ttsVoice, ttsRate, ttsVolume, onChange }: TtsControlsProps) {
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
    <div className="flex flex-col gap-4">
      {/* Voice picker */}
      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <label
          htmlFor="tts-voice"
          className="block text-sm font-medium text-foreground"
        >
          Pronunciation voice
        </label>
        <select
          id="tts-voice"
          value={ttsVoice ?? ""}
          onChange={(e) => onChange({ ttsVoice: e.target.value === "" ? null : e.target.value })}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
        >
          <option value="">Auto (system default)</option>
          {voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          English voices from your device. &ldquo;Auto&rdquo; picks the highest-quality British English voice available.
          This voice is used for the spoken-name fallback; pre-generated name audio uses a fixed British English voice.
        </p>
      </div>

      {/* Rate slider */}
      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="tts-rate"
            className="block text-sm font-medium text-foreground"
          >
            Speech rate ({ttsRate.toFixed(1)}×)
          </label>
          <button
            type="button"
            onClick={handlePreview}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Hear sample
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
          <span>0.5× slow</span>
          <span>2.0× fast</span>
        </div>
      </div>

      {/* Volume slider */}
      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <label
          htmlFor="tts-volume"
          className="block text-sm font-medium text-foreground"
        >
          Speech volume ({Math.round(ttsVolume * 100)}%)
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
          <span>0% mute</span>
          <span>100% full</span>
        </div>
      </div>
    </div>
  );
}
