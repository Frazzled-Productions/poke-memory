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
});
