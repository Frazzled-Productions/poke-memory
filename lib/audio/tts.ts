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
 * handler) - calling it after an `await` loses the gesture context in
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

// Apple's iOS/macOS voices include the tier in their `name` field - 
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

// ---------------------------------------------------------------------------
// Audio element - static MP3 path
// ---------------------------------------------------------------------------

// Tracks the currently-playing Audio element so we can stop it before
// starting a new one, mirroring the speechSynthesis.cancel() guard.
let _currentAudio: HTMLAudioElement | null = null;

function stopCurrentAudio(): void {
  if (_currentAudio !== null) {
    _currentAudio.pause();
    _currentAudio = null;
  }
}

/**
 * Returns a Promise that resolves when any in-flight TTS audio finishes.
 *
 * Covers two playback paths:
 *   1. Static MP3 (`_currentAudio`) - waits for `ended` or `error`.
 *   2. Web Speech API (`speechSynthesis.speaking`) - polls at 50 ms until
 *      the utterance queue drains, then resolves.
 *
 * Resolves immediately when neither path is active. A 5-second safety net
 * prevents an infinite wait if an event is never dispatched.
 */
export function awaitTtsEnd(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  const audioPlaying = _currentAudio !== null && !_currentAudio.paused;
  const speechPlaying =
    "speechSynthesis" in window &&
    (window.speechSynthesis.speaking || window.speechSynthesis.pending);

  if (!audioPlaying && !speechPlaying) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      clearInterval(pollTimer);
      resolve();
    };

    // Safety net - never stall longer than 5 s.
    const safetyTimer = setTimeout(finish, 5_000);

    if (audioPlaying && _currentAudio !== null) {
      const captured = _currentAudio;
      captured.addEventListener("ended", finish, { once: true });
      captured.addEventListener("error", finish, { once: true });
    }

    // Poll the speechSynthesis queue. This covers both the Web Speech path
    // and the case where the MP3 path fell back to speech mid-play.
    const pollTimer = setInterval(() => {
      const stillSpeaking =
        "speechSynthesis" in window &&
        (window.speechSynthesis.speaking || window.speechSynthesis.pending);
      const stillAudio = _currentAudio !== null && !_currentAudio.paused;
      if (!stillSpeaking && !stillAudio) finish();
    }, 50);
  });
}

// ---------------------------------------------------------------------------
// speakName
// ---------------------------------------------------------------------------

/**
 * Speak a Pokémon name aloud.
 *
 * When `id` is a number and `Audio` is available in this environment, the
 * pre-generated static MP3 at `/audio/names/<id>.mp3` is played via an Audio
 * element. On any playback error (missing file, decode failure, rejected
 * promise) the function falls back to the Web Speech API path.
 *
 * When `id` is null/undefined, the Web Speech API path is used directly - 
 * no regression from the prior behaviour.
 *
 * Settings (`ttsRate`, `ttsVolume`, `ttsVoice`) resolve from the `overrides`
 * parameter when provided, otherwise from `loadSettings()`.
 */
export function speakName(
  name: string,
  id?: number | null,
  overrides?: { ttsVoice?: string | null; ttsRate?: number; ttsVolume?: number },
): void {
  // Resolve settings synchronously - captures state at call time, avoids stale closure.
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

  // ---------------------------------------------------------------------------
  // Audio element path - used when a numeric id is supplied and Audio exists.
  // ---------------------------------------------------------------------------
  if (typeof id === "number" && typeof Audio !== "undefined") {
    stopCurrentAudio();
    // Also cancel any in-flight Web Speech utterance.
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    }

    const audio = new Audio(`/audio/names/${id}.mp3`);
    audio.playbackRate = ttsRate;
    audio.volume = ttsVolume;
    _currentAudio = audio;

    let hasCalledFallback = false;
    const fallbackToSpeech = (): void => {
      // A 404 fires both the 'error' event and rejects play() - guard so only
      // the first call reaches speakNameViaSpeech; the second would cancel the
      // utterance the first already queued.
      if (hasCalledFallback) return;
      hasCalledFallback = true;
      if (_currentAudio === audio) _currentAudio = null;
      speakNameViaSpeech(name, ttsVoice, ttsRate, ttsVolume);
    };

    audio.addEventListener("error", fallbackToSpeech, { once: true });

    // Clear the module reference when playback finishes naturally, so the
    // "_currentAudio === null means nothing is playing" invariant holds and
    // the next call does not pause an already-ended element.
    audio.addEventListener(
      "ended",
      () => {
        if (_currentAudio === audio) _currentAudio = null;
      },
      { once: true },
    );

    audio.play().catch(() => {
      fallbackToSpeech();
    });

    return;
  }

  // ---------------------------------------------------------------------------
  // Web Speech API path - no id supplied, or Audio unavailable.
  // ---------------------------------------------------------------------------
  speakNameViaSpeech(name, ttsVoice, ttsRate, ttsVolume);
}

function speakNameViaSpeech(
  name: string,
  ttsVoice: string | null,
  ttsRate: number,
  ttsVolume: number,
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  initVoices();

  // Chrome bug (crbug.com/335907): cancel() + speak() in the same tick silently no-ops.
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();

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
