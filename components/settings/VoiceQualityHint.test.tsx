import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockVoice = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

function voice(name: string, lang = "en-GB"): MockVoice {
  return { voiceURI: `${name}:${lang}`, name, lang, localService: true, default: false };
}

function installSpeechAPI(voices: MockVoice[]): { fire: () => void; setVoices: (next: MockVoice[]) => void } {
  let current = voices;
  const listeners: Array<() => void> = [];
  const synth = {
    getVoices: () => current,
    speaking: false,
    pending: false,
    speak: vi.fn(),
    cancel: vi.fn(),
    addEventListener(_type: string, fn: () => void) {
      listeners.push(fn);
    },
    removeEventListener(_type: string, fn: () => void) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  // Object.defineProperty so it sticks across the test even though jsdom's window
  // already has a `speechSynthesis` getter on some configs.
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true });
  return {
    fire: () => listeners.forEach((f) => f()),
    setVoices: (next) => {
      current = next;
    },
  };
}

const DISMISS_KEY = "poke-memory:settings:voice-tip:v1";

// jsdom 29 on this Node version does not ship localStorage out of the box, so
// the component test has to provide its own stub.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
}

describe("VoiceQualityHint", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, "localStorage", { value: makeLocalStorage(), configurable: true, writable: true });
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("renders nothing when the picked voice is Premium tier", async () => {
    installSpeechAPI([voice("Daniel (Premium)")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
  });

  it("renders nothing when the picked voice is Enhanced tier", async () => {
    installSpeechAPI([voice("Serena (Enhanced)")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
  });

  it("renders the hint when the picked voice is Compact tier", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.getByText(/voice sounding robotic/i)).toBeInTheDocument();
  });

  it("renders nothing when no voices are available", async () => {
    installSpeechAPI([]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
  });

  it("hides after dismiss and persists the dismissal in localStorage", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.getByText(/voice sounding robotic/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /dismiss tip/i }));

    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe("1");
  });

  it("stays hidden on subsequent renders when previously dismissed", async () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
  });

  it("updates when voiceschanged fires later with a better voice", async () => {
    const handle = installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    render(<VoiceQualityHint />);
    expect(screen.getByText(/voice sounding robotic/i)).toBeInTheDocument();

    act(() => {
      handle.setVoices([voice("Daniel (Premium)")]);
      handle.fire();
    });

    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
  });
});
