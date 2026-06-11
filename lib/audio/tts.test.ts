import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

type MockVoice = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

function voice(lang: string, localService = false, name = `voice-${lang}`): MockVoice {
  return { voiceURI: `${name}:${lang}`, name, lang, localService, default: false };
}

type MockSynthesis = {
  getVoices: () => MockVoice[];
  speaking: boolean;
  pending: boolean;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  fire: (type: string) => void;
  setVoices: (next: MockVoice[]) => void;
};

function makeSynthesis(initialVoices: MockVoice[], opts: { speaking?: boolean; pending?: boolean } = {}): MockSynthesis {
  let voices = [...initialVoices];
  const listeners: Record<string, Array<() => void>> = {};

  return {
    getVoices: () => voices,
    speaking: opts.speaking ?? false,
    pending: opts.pending ?? false,
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners[type] ?? [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    fire(type) {
      [...(listeners[type] ?? [])].forEach((f) => f());
    },
    setVoices(next) {
      voices = next;
    },
  };
}

class MockUtterance {
  lang = "";
  voice: MockVoice | null = null;
  rate = 1;
  volume = 1;
  constructor(public text: string) {}
}

function stubSpeechAPIs(synth: MockSynthesis): void {
  vi.stubGlobal("window", { speechSynthesis: synth });
  vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
}

describe("speakName", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("no-ops when window is undefined", async () => {
    // window is genuinely undefined in node env until we stub it.
    const { speakName } = await import("./tts");
    expect(() => speakName("Bulbasaur")).not.toThrow();
  });

  it("no-ops when speechSynthesis is missing from window", async () => {
    vi.stubGlobal("window", {});
    const { speakName } = await import("./tts");
    expect(() => speakName("Bulbasaur")).not.toThrow();
  });

  it("speaks an utterance with lang=en-GB and the supplied text", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.text).toBe("Bulbasaur");
    expect(utterance.lang).toBe("en-GB");
  });

  it("prefers a local en-GB voice over network en-GB and over other locales", async () => {
    const localGB = voice("en-GB", true, "Daniel");
    const networkGB = voice("en-GB", false, "Google UK English");
    const localUS = voice("en-US", true, "Samantha");
    const synth = makeSynthesis([localUS, networkGB, localGB]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(localGB);
  });

  it("falls back to any en-GB voice when no local en-GB exists", async () => {
    const networkGB = voice("en-GB", false, "Google UK English");
    const localUS = voice("en-US", true, "Samantha");
    const synth = makeSynthesis([localUS, networkGB]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(networkGB);
  });

  it("falls back to any en-* voice when no en-GB exists", async () => {
    const localUS = voice("en-US", true, "Samantha");
    const fr = voice("fr-FR", true, "Thomas");
    const synth = makeSynthesis([fr, localUS]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(localUS);
  });

  it("leaves voice unset when no English voice exists", async () => {
    const fr = voice("fr-FR", true, "Thomas");
    const synth = makeSynthesis([fr]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBeNull();
  });

  it("cancels an in-flight utterance before speaking", async () => {
    const synth = makeSynthesis([voice("en-GB", true)], { speaking: true });
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect(synth.cancel).toHaveBeenCalledOnce();
    expect(synth.speak).toHaveBeenCalledOnce();
  });

  it("cancels a pending utterance before speaking", async () => {
    const synth = makeSynthesis([voice("en-GB", true)], { pending: true });
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect(synth.cancel).toHaveBeenCalledOnce();
  });

  it("does not cancel when nothing is speaking or pending", async () => {
    const synth = makeSynthesis([voice("en-GB", true)]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect(synth.cancel).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledOnce();
  });

  it("re-picks the voice after voiceschanged fires later", async () => {
    // Voices empty at module init - initial pick yields null.
    const synth = makeSynthesis([]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();
    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBeNull();

    // Now voices become available; fire the voiceschanged listener registered by init.
    const localGB = voice("en-GB", true, "Daniel");
    synth.setVoices([localGB]);
    synth.fire("voiceschanged");

    speakName("Ivysaur");
    vi.runAllTimers();
    expect((synth.speak.mock.calls[1][0] as MockUtterance).voice).toBe(localGB);
  });

  it("applies phonetic overrides to the utterance text when one exists", async () => {
    const synth = makeSynthesis([voice("en-GB", true)]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Mewtwo");
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.text).toBe("mew two");
  });

  it("registers the voiceschanged listener only once across multiple speakName calls", async () => {
    const synth = makeSynthesis([voice("en-GB", true)]);
    const addSpy = vi.spyOn(synth, "addEventListener");
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    speakName("Ivysaur");
    speakName("Venusaur");
    vi.runAllTimers();

    const voiceschangedRegistrations = addSpy.mock.calls.filter(([type]) => type === "voiceschanged");
    expect(voiceschangedRegistrations.length).toBe(1);
  });

  it("prefers a Premium en-GB voice over a Compact en-GB voice", async () => {
    const compact = voice("en-GB", true, "Daniel");
    const premium = voice("en-GB", true, "Daniel (Premium)");
    const synth = makeSynthesis([compact, premium]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBe(premium);
  });

  it("prefers an Enhanced en-GB voice over a Compact en-GB voice", async () => {
    const compact = voice("en-GB", true, "Daniel");
    const enhanced = voice("en-GB", true, "Serena (Enhanced)");
    const synth = makeSynthesis([compact, enhanced]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBe(enhanced);
  });

  it("prefers Premium over Enhanced within en-GB", async () => {
    const enhanced = voice("en-GB", true, "Serena (Enhanced)");
    const premium = voice("en-GB", true, "Daniel (Premium)");
    const synth = makeSynthesis([enhanced, premium]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBe(premium);
  });

  it("still keeps a Compact en-GB voice over a Premium en-US voice (locale dominates tier)", async () => {
    const compactGB = voice("en-GB", true, "Daniel");
    const premiumUS = voice("en-US", true, "Samantha (Premium)");
    const synth = makeSynthesis([premiumUS, compactGB]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBe(compactGB);
  });

  it("prefers Enhanced en-US over Compact en-US when no en-GB exists", async () => {
    const compact = voice("en-US", true, "Samantha");
    const enhanced = voice("en-US", true, "Samantha (Enhanced)");
    const synth = makeSynthesis([compact, enhanced]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBe(enhanced);
  });

  it("treats a Siri voice as premium tier", async () => {
    const compact = voice("en-GB", true, "Daniel");
    const siri = voice("en-GB", true, "Siri Voice 1");
    const synth = makeSynthesis([compact, siri]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur");
    vi.runAllTimers();

    expect((synth.speak.mock.calls[0][0] as MockUtterance).voice).toBe(siri);
  });
});

describe("speakName with TTS settings (#429)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("applies ttsRate to the utterance", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", null, { ttsRate: 1.5, ttsVolume: 1, ttsVoice: null });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance & { rate: number };
    expect(utterance.rate).toBe(1.5);
  });

  it("applies ttsVolume to the utterance", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", null, { ttsRate: 1, ttsVolume: 0.6, ttsVoice: null });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance & { volume: number };
    expect(utterance.volume).toBe(0.6);
  });

  it("pins the voice by voiceURI when ttsVoice is set", async () => {
    const daniel = voice("en-GB", true, "Daniel");
    const karen = voice("en-AU", true, "Karen");
    const synth = makeSynthesis([daniel, karen]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", null, { ttsVoice: karen.voiceURI, ttsRate: 1, ttsVolume: 1 });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(karen);
  });

  it("falls back to the auto-picked preferred voice when pinned URI is not found", async () => {
    const daniel = voice("en-GB", true, "Daniel");
    const synth = makeSynthesis([daniel]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", null, { ttsVoice: "voice-that-does-not-exist:en-XX", ttsRate: 1, ttsVolume: 1 });
    vi.runAllTimers();

    // Falls back to preferred (daniel)
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(daniel);
  });

  it("uses auto-pick logic (preferredVoice) when ttsVoice is null", async () => {
    const daniel = voice("en-GB", true, "Daniel");
    const synth = makeSynthesis([daniel]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", null, { ttsVoice: null, ttsRate: 1, ttsVolume: 1 });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(daniel);
  });

  it("defaults rate=1 and volume=1 when overrides omit those keys", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", null, {});
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance & { rate: number; volume: number };
    expect(utterance.rate).toBe(1);
    expect(utterance.volume).toBe(1);
  });
});

describe("warmupTts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("no-ops when window is undefined", async () => {
    const { warmupTts } = await import("./tts");
    expect(() => warmupTts()).not.toThrow();
  });

  it("no-ops when speechSynthesis is missing from window", async () => {
    vi.stubGlobal("window", {});
    const { warmupTts } = await import("./tts");
    expect(() => warmupTts()).not.toThrow();
  });

  it("calls speechSynthesis.speak with volume=0", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { warmupTts } = await import("./tts");

    warmupTts();

    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance & { volume: number };
    expect(utterance.volume).toBe(0);
  });

  it("is idempotent - second call is a no-op", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { warmupTts } = await import("./tts");

    warmupTts();
    warmupTts();
    warmupTts();

    expect(synth.speak).toHaveBeenCalledOnce();
  });
});

describe("voiceTier", () => {
  it("classifies voices by name keyword", async () => {
    const { voiceTier } = await import("./tts");
    expect(voiceTier({ name: "Daniel" } as SpeechSynthesisVoice)).toBe("compact");
    expect(voiceTier({ name: "Daniel (Premium)" } as SpeechSynthesisVoice)).toBe("premium");
    expect(voiceTier({ name: "Serena (Enhanced)" } as SpeechSynthesisVoice)).toBe("enhanced");
    expect(voiceTier({ name: "Siri Voice 1" } as SpeechSynthesisVoice)).toBe("premium");
    expect(voiceTier({ name: "Google UK English Neural" } as SpeechSynthesisVoice)).toBe("enhanced");
    expect(voiceTier(null)).toBe("compact");
  });
});

describe("getPreferredVoice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns null when speechSynthesis is unavailable", async () => {
    vi.stubGlobal("window", {});
    const { getPreferredVoice } = await import("./tts");
    expect(getPreferredVoice()).toBeNull();
  });

  it("returns the picked voice once voices are loaded", async () => {
    const daniel = voice("en-GB", true, "Daniel");
    const synth = makeSynthesis([daniel]);
    stubSpeechAPIs(synth);
    const { getPreferredVoice } = await import("./tts");

    expect(getPreferredVoice()).toBe(daniel);
  });
});

// ---------------------------------------------------------------------------
// Audio element path (pre-generated MP3s, id provided)
// ---------------------------------------------------------------------------

type AudioEventMap = Map<string, Array<(e: Event) => void>>;

type MockAudio = {
  src: string;
  playbackRate: number;
  volume: number;
  play: Mock;
  pause: Mock;
  addEventListener: Mock;
  _fireError: () => void;
  _listeners: AudioEventMap;
};

function makeMockAudio(overrides: Partial<{ play: Mock }> = {}): MockAudio {
  const listeners: AudioEventMap = new Map();

  const audio: MockAudio = {
    src: "",
    playbackRate: 1,
    volume: 1,
    play: overrides.play ?? vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    addEventListener: vi.fn(function (type: string, fn: (e: Event) => void) {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    }),
    _fireError() {
      for (const fn of listeners.get("error") ?? []) {
        fn(new Event("error"));
      }
    },
    _listeners: listeners,
  };
  return audio;
}

/**
 * Build a constructor function (not an arrow function) that vitest can call
 * with `new`. Returning a non-null object from a constructor overrides the
 * default `this`, so the caller and the constructor share the same reference.
 */
function makeAudioCtor(mockAudio: MockAudio): new (src: string) => MockAudio {
  const spy = vi.fn(function (src: string) {
    mockAudio.src = src;
    return mockAudio;
  });
  return spy as unknown as new (src: string) => MockAudio;
}

/**
 * Build a multi-instance Audio constructor that returns different mock objects
 * on each successive `new Audio(...)` call.
 */
function makeMultiAudioCtor(mocks: MockAudio[]): new (src: string) => MockAudio {
  let idx = 0;
  const spy = vi.fn(function (src: string) {
    const mock = mocks[idx++ % mocks.length];
    mock.src = src;
    return mock;
  });
  return spy as unknown as new (src: string) => MockAudio;
}

describe("speakName - Audio element path (id provided)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("creates an Audio element with the correct src when id is given", async () => {
    const mockAudio = makeMockAudio();
    const AudioCtor = makeAudioCtor(mockAudio);
    vi.stubGlobal("Audio", AudioCtor);
    // window must exist so speechSynthesis branch can be reached for fallback checks
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1);

    // play() called on the mock audio object
    expect(mockAudio.play).toHaveBeenCalledOnce();
    expect(mockAudio.src).toBe("/audio/names/1.mp3");
  });

  it("applies ttsRate and ttsVolume to the Audio element", async () => {
    const mockAudio = makeMockAudio();
    vi.stubGlobal("Audio", makeAudioCtor(mockAudio));
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1, { ttsRate: 1.5, ttsVolume: 0.7, ttsVoice: null });

    expect(mockAudio.playbackRate).toBe(1.5);
    expect(mockAudio.volume).toBe(0.7);
  });

  it("falls back to Web Speech API when the Audio element fires an error", async () => {
    const mockAudio = makeMockAudio();
    vi.stubGlobal("Audio", makeAudioCtor(mockAudio));
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1);

    // Simulate audio load failure
    mockAudio._fireError();
    vi.runAllTimers();

    // Web Speech fallback should have spoken
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.text).toBe("Bulbasaur");
  });

  it("falls back to Web Speech API when play() rejects", async () => {
    const mockAudio = makeMockAudio({
      play: vi.fn(() => Promise.reject(new Error("NotAllowedError"))),
    });
    vi.stubGlobal("Audio", makeAudioCtor(mockAudio));
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1);

    // Flush the rejected promise then run timers for the fallback setTimeout
    await Promise.resolve();
    vi.runAllTimers();

    expect(synth.speak).toHaveBeenCalledOnce();
  });

  it("falls back exactly once when error event and play() rejection both fire", async () => {
    const mockAudio = makeMockAudio({
      play: vi.fn(() => Promise.reject(new Error("AbortError"))),
    });
    vi.stubGlobal("Audio", makeAudioCtor(mockAudio));
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1);

    // Fire error event first (as a browser does on 404), then flush play() rejection.
    mockAudio._fireError();
    await Promise.resolve();
    vi.runAllTimers();

    // The second path must not invoke speakNameViaSpeech again - that would
    // cancel the utterance the first call already queued.
    expect(synth.speak).toHaveBeenCalledOnce();
  });

  it("uses Web Speech directly when id is null", async () => {
    const AudioCtor = vi.fn(function (this: object) {});
    vi.stubGlobal("Audio", AudioCtor);
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", null);
    vi.runAllTimers();

    expect(AudioCtor).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledOnce();
  });

  it("uses Web Speech directly when id is undefined", async () => {
    const AudioCtor = vi.fn(function (this: object) {});
    vi.stubGlobal("Audio", AudioCtor);
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur");
    vi.runAllTimers();

    expect(AudioCtor).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledOnce();
  });

  it("stops the previously-playing Audio element before starting a new one", async () => {
    const firstAudio = makeMockAudio();
    const secondAudio = makeMockAudio();
    vi.stubGlobal("Audio", makeMultiAudioCtor([firstAudio, secondAudio]));
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1);
    speakName("Ivysaur", 2);

    expect(firstAudio.pause).toHaveBeenCalledOnce();
    expect(secondAudio.play).toHaveBeenCalledOnce();
  });

  // F36: non-English locale should bypass the MP3 path and use Web Speech directly.
  it("skips MP3 path and uses Web Speech when locale is 'ja' (F36)", async () => {
    const AudioCtor = vi.fn(function (this: object) {});
    vi.stubGlobal("Audio", AudioCtor);
    const synth = makeSynthesis([voice("ja", true, "Kyoko")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("フシギダネ", 1, { locale: "ja" });
    vi.runAllTimers();

    // MP3 constructor must NOT be called
    expect(AudioCtor).not.toHaveBeenCalled();
    // Web Speech must be used
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.lang).toBe("ja");
    expect(utterance.text).toBe("フシギダネ");
  });

  it("skips MP3 path and uses Web Speech when locale is 'zh-Hans' (F36)", async () => {
    const AudioCtor = vi.fn(function (this: object) {});
    vi.stubGlobal("Audio", AudioCtor);
    const synth = makeSynthesis([voice("zh-Hans", true, "Ting-Ting")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("妙蛙种子", 1, { locale: "zh-Hans" });
    vi.runAllTimers();

    expect(AudioCtor).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.lang).toBe("zh-Hans");
  });

  it("skips MP3 path and uses Web Speech when locale is 'zh-Hant' (F36)", async () => {
    const AudioCtor = vi.fn(function (this: object) {});
    vi.stubGlobal("Audio", AudioCtor);
    const synth = makeSynthesis([voice("zh-Hant", true, "Mei-Jia")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("妙蛙種子", 1, { locale: "zh-Hant" });
    vi.runAllTimers();

    expect(AudioCtor).not.toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.lang).toBe("zh-Hant");
  });

  it("still uses MP3 path for English locale (F36 - no regression)", async () => {
    const mockAudio = makeMockAudio();
    vi.stubGlobal("Audio", makeAudioCtor(mockAudio));
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    vi.stubGlobal("window", { speechSynthesis: synth });
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);

    const { speakName } = await import("./tts");
    speakName("Bulbasaur", 1, { locale: "en" });

    expect(mockAudio.play).toHaveBeenCalledOnce();
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
