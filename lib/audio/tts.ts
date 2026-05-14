import { pronunciationFor } from "./pronunciations";
import { loadSettings } from "@/lib/settings/persistence";

export type VoiceTier = "premium" | "enhanced" | "compact";

// ---------------------------------------------------------------------------
// TTS warm-up
// ---------------------------------------------------------------------------

// Tracks whether we have already fired a warm-up utterance this session.
// Module-scoped so it survives re-renders without a React ref.
let _warmedUp = false;

/**
 * Fire a near-silent, near-instant utterance to satisfy the browser's
 * autoplay/user-gesture requirement for `speechSynthesis.speak()`.
 *
 * Must be called synchronously inside a user-gesture handler (e.g. a click
 * handler) — calling it after an `await` loses the gesture context in
 * Chromium and WebKit.
 *
 * Idempotent: the second and subsequent calls are no-ops.
 */
export function warmupTts(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  if (_warmedUp) return;
  _warmedUp = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  u.rate = 10; // finish as quickly as possible
  window.speechSynthesis.speak(u);
}

// Apple's iOS/macOS voices include the tier in their `name` field —
// "Daniel" (Compact), "Daniel (Enhanced)", "Daniel (Premium)", "Siri Voice 1".
// Google's Chrome voices use "Neural" / "Standard". We detect these so a user
// who has downloaded a higher-quality voice gets it picked automatically.
const PREMIUM_RE = /\b(premium|siri)\b/i;
const ENHANCED_RE = /\b(enhanced|neural)\b/i;

export function voiceTier(voice: SpeechSynthesisVoice | null): VoiceTier {
  if (voice === null) return "compact";
  if (PREMIUM_RE.test(voice.name)) return "premium";
  if (ENHANCED_RE.test(voice.name)) return "enhanced";
  return "compact";
}

function tierScore(voice: SpeechSynthesisVoice): number {
  if (PREMIUM_RE.test(voice.name)) return 3;
  if (ENHANCED_RE.test(voice.name)) return 2;
  return 1;
}

// Locale dominates tier: a Compact en-GB voice still wins over a Premium en-US
// one. Switching the user to a US voice because it sounds "nicer" is more
// surprising than keeping the British accent they asked for. Within the same
// locale-tier bucket, prefer locally-installed voices over network ones.
function isBetterVoice(a: SpeechSynthesisVoice, b: SpeechSynthesisVoice): boolean {
  const gbA = a.lang.startsWith("en-GB");
  const gbB = b.lang.startsWith("en-GB");
  if (gbA !== gbB) return gbA;
  const sa = tierScore(a);
  const sb = tierScore(b);
  if (sa !== sb) return sa > sb;
  if (a.localService !== b.localService) return a.localService;
  return false;
}

function pickBest(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  let best = voices[0];
  for (let i = 1; i < voices.length; i += 1) {
    if (isBetterVoice(voices[i], best)) best = voices[i];
  }
  return best;
}

let preferredVoice: SpeechSynthesisVoice | null = null;
let voicesInitialised = false;

function pickVoice(): void {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;
  const englishVoices = voices.filter((v) => v.lang.startsWith("en"));
  preferredVoice = pickBest(englishVoices);
}

function initVoices(): void {
  if (voicesInitialised) return;
  voicesInitialised = true;

  pickVoice();
  // Chrome fires voiceschanged asynchronously; re-pick when it does.
  window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

export function getPreferredVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  initVoices();
  return preferredVoice;
}

export function speakName(name: string, overrides?: { ttsVoice?: string | null; ttsRate?: number; ttsVolume?: number }): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  initVoices();

  // Chrome bug (crbug.com/335907): cancel() + speak() in the same tick silently no-ops.
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
  // Read settings synchronously (before setTimeout) so the call captures the
  // state at the moment speakName is invoked — avoids a stale closure.
  let resolvedSettings: { ttsVoice: string | null; ttsRate: number; ttsVolume: number };
  if (overrides !== undefined) {
    resolvedSettings = { ttsVoice: overrides.ttsVoice ?? null, ttsRate: overrides.ttsRate ?? 1, ttsVolume: overrides.ttsVolume ?? 1 };
  } else {
    try {
      const s = loadSettings();
      resolvedSettings = { ttsVoice: s.ttsVoice, ttsRate: s.ttsRate, ttsVolume: s.ttsVolume };
    } catch {
      // localStorage may throw in storage-blocked contexts (private browsing, etc.); fall back to defaults.
      resolvedSettings = { ttsVoice: null, ttsRate: 1, ttsVolume: 1 };
    }
  }
  const { ttsVoice, ttsRate, ttsVolume } = resolvedSettings;
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(pronunciationFor(name));
    utterance.lang = "en-GB";
    utterance.rate = ttsRate;
    utterance.volume = ttsVolume;

    // Resolve voice: pinned URI → auto-picked preferred → language-hint fallback.
    const voiceURI = ttsVoice ?? null;
    if (voiceURI !== null) {
      const voices = window.speechSynthesis.getVoices();
      const pinned = voices.find((v) => v.voiceURI === voiceURI) ?? null;
      utterance.voice = pinned ?? preferredVoice;
    } else if (preferredVoice !== null) {
      utterance.voice = preferredVoice;
    }
    window.speechSynthesis.speak(utterance);
  }, 0);
}
