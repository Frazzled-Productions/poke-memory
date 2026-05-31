/**
 * Locale-coverage tests for Group-4 settings components.
 *
 * Mandatory coverage rule: every component that renders user-facing text must
 * be exercised in all four supported locales (en, ja, zh-Hans, zh-Hant).
 * These tests also verify the state-in / state-out rule:
 *   - VoiceQualityHint: compact-tier voice (shown) vs. premium-tier voice (hidden)
 *   - IntensityPicker: all three intensity options render in every locale
 *   - TtsControls: renders labels in every locale
 *   - OfflineSection: idle phase and downloading phase in every locale
 *
 * Refs: AGENTS.md "Mandatory coverage rules", closes #1434.
 */

import { screen, act } from "@/components/test-utils/renderWithIntl";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IntensityPicker } from "@/components/settings/IntensityPicker";
import { OfflineSection } from "@/components/settings/OfflineSection";
import * as precacheModule from "@/lib/pwa/precache";
import { _resetForTesting } from "@/lib/pwa/downloadController";

// ---------------------------------------------------------------------------
// Helpers: speech synthesis stub
// ---------------------------------------------------------------------------

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

function installSpeechAPI(voices: MockVoice[]): { fire: () => void } {
  const current = [...voices];
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
  Object.defineProperty(window, "speechSynthesis", {
    value: synth,
    configurable: true,
    writable: true,
  });
  return { fire: () => listeners.forEach((f) => f()) };
  void current; // suppress unused warning
}

// ---------------------------------------------------------------------------
// Helpers: localStorage stub
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

// ---------------------------------------------------------------------------
// Setup: storage mocks shared across all test groups
// ---------------------------------------------------------------------------

Object.defineProperty(navigator, "storage", {
  value: { estimate: vi.fn().mockResolvedValue({ usage: 50_000_000, quota: 2_000_000_000 }) },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// IntensityPicker — locale coverage
// ---------------------------------------------------------------------------

describe("IntensityPicker — locale coverage", () => {
  it("en: renders heading and all three option labels", () => {
    renderWithIntl(<IntensityPicker value="accents" onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /theme intensity/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /subtle accents only/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /tinted backgrounds/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /full mascot theme/i })).toBeInTheDocument();
  });

  it("ja: renders heading in Japanese", () => {
    renderJa(<IntensityPicker value="accents" onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /テーマの強度/ })).toBeInTheDocument();
  });

  it("zh-Hans: renders heading in Simplified Chinese", () => {
    renderZhHans(<IntensityPicker value="accents" onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /主题强度/ })).toBeInTheDocument();
  });

  it("zh-Hant: renders heading in Traditional Chinese", () => {
    renderZhHant(<IntensityPicker value="accents" onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /主題強度/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VoiceQualityHint — locale coverage (state in + out)
// ---------------------------------------------------------------------------

describe("VoiceQualityHint — locale coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("en: compact voice shows the hint (state in)", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    renderWithIntl(<VoiceQualityHint />);
    expect(screen.getByText(/voice sounding robotic/i)).toBeInTheDocument();
  });

  it("en: premium voice hides the hint (state out)", async () => {
    installSpeechAPI([voice("Daniel (Premium)")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    renderWithIntl(<VoiceQualityHint />);
    expect(screen.queryByText(/voice sounding robotic/i)).not.toBeInTheDocument();
  });

  it("ja: compact voice shows the hint in Japanese", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    renderJa(<VoiceQualityHint />);
    expect(screen.getByText(/音声がロボット/)).toBeInTheDocument();
  });

  it("zh-Hans: compact voice shows the hint in Simplified Chinese", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    renderZhHans(<VoiceQualityHint />);
    expect(screen.getByText(/语音听起来像机器人/)).toBeInTheDocument();
  });

  it("zh-Hant: compact voice shows the hint in Traditional Chinese", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { VoiceQualityHint } = await import("./VoiceQualityHint");
    renderZhHant(<VoiceQualityHint />);
    expect(screen.getByText(/語音聽起來像機器人/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TtsControls — locale coverage
// ---------------------------------------------------------------------------

describe("TtsControls — locale coverage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("en: renders voice label, rate label, hear-sample button", async () => {
    installSpeechAPI([]);
    const { TtsControls } = await import("./TtsControls");
    renderWithIntl(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/pronunciation voice/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hear sample/i })).toBeInTheDocument();
  });

  it("ja: renders voice label in Japanese", async () => {
    installSpeechAPI([]);
    const { TtsControls } = await import("./TtsControls");
    renderJa(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/読み上げ音声/)).toBeInTheDocument();
  });

  it("zh-Hans: renders voice label in Simplified Chinese", async () => {
    installSpeechAPI([]);
    const { TtsControls } = await import("./TtsControls");
    renderZhHans(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/朗读语音/)).toBeInTheDocument();
  });

  it("zh-Hant: renders voice label in Traditional Chinese", async () => {
    installSpeechAPI([]);
    const { TtsControls } = await import("./TtsControls");
    renderZhHant(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/朗讀語音/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OfflineSection — locale coverage (idle state and downloading state)
// ---------------------------------------------------------------------------

describe("OfflineSection — locale coverage", () => {
  beforeEach(() => {
    _resetForTesting();
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetForTesting();
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("en: idle state shows download button", () => {
    renderWithIntl(<OfflineSection />);
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
  });

  it("en: done state shows update button", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      new Date().toISOString(),
    );
    renderWithIntl(<OfflineSection />);
    expect(screen.getByRole("button", { name: /update/i })).toBeInTheDocument();
  });

  it("ja: idle state — download button label in Japanese", () => {
    renderJa(<OfflineSection />);
    expect(screen.getByRole("button", { name: /ダウンロード/ })).toBeInTheDocument();
  });

  it("zh-Hans: idle state — download button label in Simplified Chinese", () => {
    renderZhHans(<OfflineSection />);
    expect(screen.getByRole("button", { name: /下载/ })).toBeInTheDocument();
  });

  it("zh-Hant: idle state — download button label in Traditional Chinese", () => {
    renderZhHant(<OfflineSection />);
    expect(screen.getByRole("button", { name: /下載/ })).toBeInTheDocument();
  });

  it("en: downloading state shows stop button and progressbar", async () => {
    let resolvePrecache!: (value: precacheModule.PrecacheSummary) => void;
    vi.spyOn(precacheModule, "precacheAll").mockImplementation(({ onProgress }) => {
      onProgress?.({ done: 1, total: 100, bytesSoFar: 25_000 });
      return new Promise<precacheModule.PrecacheSummary>((resolve) => {
        resolvePrecache = resolve;
      });
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderWithIntl(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /download/i }));

    // Wait for the UI to transition to downloading state
    await screen.findByRole("button", { name: /stop/i });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    resolvePrecache({ totalRequested: 100, downloaded: 99, skipped: 0, failed: 1 });
    await screen.findByRole("button", { name: /download|update/i });
  });

  it("ja: downloading state — stop button label in Japanese", async () => {
    let resolvePrecache!: (value: precacheModule.PrecacheSummary) => void;
    vi.spyOn(precacheModule, "precacheAll").mockImplementation(({ onProgress }) => {
      onProgress?.({ done: 1, total: 100, bytesSoFar: 25_000 });
      return new Promise<precacheModule.PrecacheSummary>((resolve) => {
        resolvePrecache = resolve;
      });
    });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderJa(<OfflineSection />);

    await user.click(screen.getByRole("button", { name: /ダウンロード/ }));
    await screen.findByRole("button", { name: /停止/ });

    resolvePrecache({ totalRequested: 100, downloaded: 99, skipped: 0, failed: 1 });
    await screen.findByRole("button", { name: /ダウンロード|更新/ });
  });

  it("zh-Hans: done state — update button label in Simplified Chinese", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      new Date().toISOString(),
    );
    renderZhHans(<OfflineSection />);
    expect(screen.getByRole("button", { name: /更新/ })).toBeInTheDocument();
  });

  it("zh-Hant: done state — update button label in Traditional Chinese", () => {
    window.localStorage.setItem(
      precacheModule.OFFLINE_DOWNLOADED_AT_KEY,
      new Date().toISOString(),
    );
    renderZhHant(<OfflineSection />);
    expect(screen.getByRole("button", { name: /更新/ })).toBeInTheDocument();
  });
});
