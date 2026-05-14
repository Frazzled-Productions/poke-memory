import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    // Voices empty at module init — initial pick yields null.
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

    speakName("Bulbasaur", { ttsRate: 1.5, ttsVolume: 1, ttsVoice: null });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance & { rate: number };
    expect(utterance.rate).toBe(1.5);
  });

  it("applies ttsVolume to the utterance", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", { ttsRate: 1, ttsVolume: 0.6, ttsVoice: null });
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

    speakName("Bulbasaur", { ttsVoice: karen.voiceURI, ttsRate: 1, ttsVolume: 1 });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(karen);
  });

  it("falls back to the auto-picked preferred voice when pinned URI is not found", async () => {
    const daniel = voice("en-GB", true, "Daniel");
    const synth = makeSynthesis([daniel]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", { ttsVoice: "voice-that-does-not-exist:en-XX", ttsRate: 1, ttsVolume: 1 });
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

    speakName("Bulbasaur", { ttsVoice: null, ttsRate: 1, ttsVolume: 1 });
    vi.runAllTimers();

    const utterance = synth.speak.mock.calls[0][0] as MockUtterance;
    expect(utterance.voice).toBe(daniel);
  });

  it("defaults rate=1 and volume=1 when overrides omit those keys", async () => {
    const synth = makeSynthesis([voice("en-GB", true, "Daniel")]);
    stubSpeechAPIs(synth);
    const { speakName } = await import("./tts");

    speakName("Bulbasaur", {});
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

  it("is idempotent — second call is a no-op", async () => {
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
