import { render, screen, act, fireEvent } from "@testing-library/react";
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
  let current = [...voices];
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
  return {
    fire: () => listeners.forEach((f) => f()),
    setVoices: (next) => { current = next; },
  };
}

describe("TtsControls", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (window as unknown as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("renders the voice picker, rate slider, and volume slider", async () => {
    installSpeechAPI([voice("Daniel")]);
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls
        ttsVoice={null}
        ttsRate={1}
        ttsVolume={1}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/pronunciation voice/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/speech rate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/speech volume/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hear sample/i })).toBeInTheDocument();
  });

  it("populates the voice picker with English voices from speechSynthesis", async () => {
    installSpeechAPI([voice("Daniel", "en-GB"), voice("Karen", "en-AU"), voice("Thomas", "fr-FR")]);
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={vi.fn()} />
    );
    // English voices appear; French voice is filtered out
    expect(screen.getByRole("option", { name: /Daniel \(en-GB\)/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Karen \(en-AU\)/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Thomas/i })).not.toBeInTheDocument();
    // Auto option always present
    expect(screen.getByRole("option", { name: /auto.*system default/i })).toBeInTheDocument();
  });

  it("calls onChange with the selected voiceURI when a voice is chosen", async () => {
    const daniel = voice("Daniel", "en-GB");
    installSpeechAPI([daniel]);
    const onChange = vi.fn();
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={onChange} />
    );

    await userEvent.selectOptions(
      screen.getByLabelText(/pronunciation voice/i),
      screen.getByRole("option", { name: /Daniel \(en-GB\)/i }),
    );

    expect(onChange).toHaveBeenCalledWith({ ttsVoice: daniel.voiceURI });
  });

  it("calls onChange with null when 'Auto' is selected", async () => {
    const daniel = voice("Daniel", "en-GB");
    installSpeechAPI([daniel]);
    const onChange = vi.fn();
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={daniel.voiceURI} ttsRate={1} ttsVolume={1} onChange={onChange} />
    );

    await userEvent.selectOptions(
      screen.getByLabelText(/pronunciation voice/i),
      screen.getByRole("option", { name: /auto.*system default/i }),
    );

    expect(onChange).toHaveBeenCalledWith({ ttsVoice: null });
  });

  it("calls onChange with updated ttsRate when the rate slider changes", async () => {
    installSpeechAPI([voice("Daniel")]);
    const onChange = vi.fn();
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={onChange} />
    );

    const slider = screen.getByLabelText(/speech rate/i);
    fireEvent.change(slider, { target: { value: "1.5" } });

    expect(onChange).toHaveBeenCalledWith({ ttsRate: 1.5 });
  });

  it("calls onChange with updated ttsVolume when the volume slider changes", async () => {
    installSpeechAPI([voice("Daniel")]);
    const onChange = vi.fn();
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={onChange} />
    );

    const slider = screen.getByLabelText(/speech volume/i);
    fireEvent.change(slider, { target: { value: "0.75" } });

    expect(onChange).toHaveBeenCalledWith({ ttsVolume: 0.75 });
  });

  it("refreshes the voice list when voiceschanged fires", async () => {
    const handle = installSpeechAPI([voice("Daniel", "en-GB")]);
    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={null} ttsRate={1} ttsVolume={1} onChange={vi.fn()} />
    );

    expect(screen.queryByRole("option", { name: /Karen \(en-AU\)/i })).not.toBeInTheDocument();

    act(() => {
      handle.setVoices([voice("Daniel", "en-GB"), voice("Karen", "en-AU")]);
      handle.fire();
    });

    expect(screen.getByRole("option", { name: /Karen \(en-AU\)/i })).toBeInTheDocument();
  });

  it("invokes speech synthesis with the current rate and volume when Hear sample is clicked", async () => {
    const daniel = voice("Daniel", "en-GB");
    const handle = installSpeechAPI([daniel]);
    void handle; // referenced to suppress lint; we access synth via window below

    class LocalUtterance {
      lang = "";
      voice: MockVoice | null = null;
      rate = 1;
      volume = 1;
      constructor(public text: string) {}
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: LocalUtterance,
      configurable: true,
      writable: true,
    });

    const { TtsControls } = await import("./TtsControls");
    render(
      <TtsControls ttsVoice={null} ttsRate={1.5} ttsVolume={0.7} onChange={vi.fn()} />
    );

    await userEvent.click(screen.getByRole("button", { name: /hear sample/i }));

    const synth = window.speechSynthesis as { speak: ReturnType<typeof vi.fn> };
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as LocalUtterance;
    expect(utterance.rate).toBe(1.5);
    expect(utterance.volume).toBe(0.7);
  });
});
