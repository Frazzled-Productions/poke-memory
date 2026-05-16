/**
 * Tests for waitForAudio / awaitCryEnd / awaitTtsEnd (#732).
 *
 * Lives under components/ so the jsdom project picks it up — awaitTtsEnd polls
 * window.speechSynthesis which requires a DOM environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// MockAudio — simulates HTMLAudioElement for cry + TTS audio paths
// ---------------------------------------------------------------------------

class MockAudio {
  src = "";
  volume = 1;
  playbackRate = 1;
  currentTime = 0;
  loop = false;
  paused = true;

  private listeners: Record<string, Array<() => void>> = {};

  pause(): void {
    this.paused = true;
  }

  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }

  addEventListener(type: string, fn: () => void, _opts?: unknown): void {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    const arr = this.listeners[type] ?? [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  fire(type: string): void {
    [...(this.listeners[type] ?? [])].forEach((f) => f());
    if (type === "ended") this.paused = true;
  }
}

// ---------------------------------------------------------------------------
// awaitCryEnd
// ---------------------------------------------------------------------------

describe("awaitCryEnd", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("window", {});
    vi.stubGlobal("Audio", MockAudio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves immediately when nothing has played yet", async () => {
    const { awaitCryEnd } = await import("@/lib/audio/cry");
    await expect(awaitCryEnd()).resolves.toBeUndefined();
  });

  it("resolves immediately once the audio element is paused after 'ended'", async () => {
    const instances: MockAudio[] = [];
    const OrigAudio = MockAudio;
    vi.stubGlobal(
      "Audio",
      class extends OrigAudio {
        constructor() {
          super();
          instances.push(this);
        }
      },
    );

    const { playCry, awaitCryEnd } = await import("@/lib/audio/cry");

    playCry("/cry/1.ogg", 0.6);
    await Promise.resolve();

    const audioEl = instances[instances.length - 1];
    expect(audioEl.paused).toBe(false);

    // Simulate natural completion: fire ended, which sets paused = true.
    audioEl.fire("ended");
    expect(audioEl.paused).toBe(true);

    // Now awaitCryEnd should resolve immediately (paused is true).
    await expect(awaitCryEnd()).resolves.toBeUndefined();
  });

  it("resolves after the audio 'ended' event fires", async () => {
    vi.useFakeTimers();
    const { playCry, awaitCryEnd } = await import("@/lib/audio/cry");

    // Store reference to the last Audio instance created inside the module.
    const instances: MockAudio[] = [];
    const OrigAudio = MockAudio;
    vi.stubGlobal(
      "Audio",
      class extends OrigAudio {
        constructor() {
          super();
          instances.push(this);
        }
      },
    );

    playCry("/cry/1.ogg", 0.6);
    // Flush play() microtask so audio is active (not paused before our check).
    await Promise.resolve();

    // Audio should be playing — paused is false after play() resolves.
    const audioEl = instances[instances.length - 1];
    expect(audioEl.paused).toBe(false);

    const waitPromise = awaitCryEnd();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    // Not resolved yet.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Fire ended — promise should resolve.
    audioEl.fire("ended");
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("resolves via the 5-second safety timer if 'ended' never fires", async () => {
    vi.useFakeTimers();
    const instances: MockAudio[] = [];
    const OrigAudio = MockAudio;
    vi.stubGlobal(
      "Audio",
      class extends OrigAudio {
        constructor() {
          super();
          instances.push(this);
        }
      },
    );

    const { playCry, awaitCryEnd } = await import("@/lib/audio/cry");

    playCry("/cry/1.ogg", 0.6);
    await Promise.resolve();

    const waitPromise = awaitCryEnd();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    await Promise.resolve();
    expect(resolved).toBe(false);

    // Advance 5 seconds — safety timer fires.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// awaitTtsEnd
// ---------------------------------------------------------------------------

describe("awaitTtsEnd", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves immediately when nothing is playing", async () => {
    vi.stubGlobal("window", {
      speechSynthesis: { speaking: false, pending: false },
    });
    const { awaitTtsEnd } = await import("@/lib/audio/tts");
    await expect(awaitTtsEnd()).resolves.toBeUndefined();
  });

  it("resolves immediately outside a browser environment (no window)", async () => {
    vi.stubGlobal("window", undefined);
    const { awaitTtsEnd } = await import("@/lib/audio/tts");
    await expect(awaitTtsEnd()).resolves.toBeUndefined();
  });

  it("resolves once speechSynthesis.speaking becomes false", async () => {
    vi.useFakeTimers();

    let isSpeaking = true;
    vi.stubGlobal("window", {
      speechSynthesis: {
        get speaking() { return isSpeaking; },
        pending: false,
      },
    });

    const { awaitTtsEnd } = await import("@/lib/audio/tts");

    const waitPromise = awaitTtsEnd();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    // Not resolved while speaking.
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);

    isSpeaking = false;

    // Next poll (50 ms interval) should detect idle and resolve.
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve(); // flush .then()
    expect(resolved).toBe(true);
  });

  it("resolves via the 5-second safety timer if speech never finishes", async () => {
    vi.useFakeTimers();

    vi.stubGlobal("window", {
      speechSynthesis: { speaking: true, pending: false },
    });

    const { awaitTtsEnd } = await import("@/lib/audio/tts");

    const waitPromise = awaitTtsEnd();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// waitForAudio (integration of both helpers)
// ---------------------------------------------------------------------------

describe("waitForAudio", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves immediately when no audio is in flight", async () => {
    // Uses real timers so the setTimeout(0) yield inside waitForAudio resolves
    // naturally without needing explicit timer advancement.
    vi.stubGlobal("window", {
      speechSynthesis: { speaking: false, pending: false },
    });
    vi.stubGlobal("Audio", MockAudio);
    const { waitForAudio } = await import("@/lib/audio/waitForAudio");
    await expect(waitForAudio()).resolves.toBeUndefined();
  });

  it("gates on the last audio to finish when both cry and TTS are playing", async () => {
    vi.useFakeTimers();

    let isSpeaking = true;
    const instances: MockAudio[] = [];
    const OrigAudio = MockAudio;

    vi.stubGlobal(
      "Audio",
      class extends OrigAudio {
        constructor() {
          super();
          instances.push(this);
        }
      },
    );
    vi.stubGlobal("window", {
      speechSynthesis: {
        get speaking() { return isSpeaking; },
        pending: false,
      },
    });

    // Start a cry.
    const { playCry } = await import("@/lib/audio/cry");
    playCry("/cry/1.ogg", 0.6);
    await Promise.resolve();
    const audioEl = instances[instances.length - 1];
    expect(audioEl.paused).toBe(false);

    const { waitForAudio } = await import("@/lib/audio/waitForAudio");
    const waitPromise = waitForAudio();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    // Cry ends, but TTS is still speaking.
    audioEl.fire("ended");
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Now TTS also finishes.
    isSpeaking = false;
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("resolves once timers tick when both cry and TTS are idle", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Audio", MockAudio);
    vi.stubGlobal("window", {
      speechSynthesis: { speaking: false, pending: false },
    });

    const { waitForAudio } = await import("@/lib/audio/waitForAudio");
    const waitPromise = waitForAudio();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    // The sequential flow always yields a setTimeout(0) macrotask between the
    // cry and TTS legs, even when both are idle. Advance past it.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it("does not resolve until TTS finishes when TTS starts only after the cry ends (chained flow)", async () => {
    // This is the PRIMARY real-world scenario for dual-audio mode:
    //   playCry(url, vol, speakAfterCry) — cry plays; speakAfterCry fires when
    //   the cry's 'ended' event fires and starts TTS. waitForAudio() is called
    //   while the cry is still playing and TTS has NOT started yet.
    //
    // The sequential await in waitForAudio must gate on BOTH legs: first
    // awaiting the cry, then (after yielding so TTS has been queued) awaiting
    // TTS. If the two were awaited concurrently (Promise.all), waitForAudio
    // would settle the moment the cry ends — exactly when TTS begins — and the
    // card would swap over the start of the spoken name.
    vi.useFakeTimers();

    // TTS starts as idle; it becomes active only after the cry ends.
    let isSpeaking = false;
    const instances: MockAudio[] = [];
    const OrigAudio = MockAudio;

    vi.stubGlobal(
      "Audio",
      class extends OrigAudio {
        constructor() {
          super();
          instances.push(this);
        }
      },
    );
    vi.stubGlobal("window", {
      speechSynthesis: {
        get speaking() { return isSpeaking; },
        pending: false,
      },
    });

    // Set up a cry with an onEnded callback that starts TTS (chained flow).
    const { playCry } = await import("@/lib/audio/cry");
    playCry("/cry/1.ogg", 0.6, () => {
      // Simulate speakAfterCry: TTS begins when the cry ends.
      isSpeaking = true;
    });
    await Promise.resolve(); // flush play() microtask
    const cryEl = instances[instances.length - 1];
    expect(cryEl.paused).toBe(false);

    // Call waitForAudio while TTS is still idle — only the cry is active.
    const { waitForAudio } = await import("@/lib/audio/waitForAudio");
    const waitPromise = waitForAudio();
    let resolved = false;
    void waitPromise.then(() => { resolved = true; });

    // Cry ends — this fires playCry's onEnded callback (sets isSpeaking=true),
    // then resolves awaitCryEnd. waitForAudio must NOT resolve yet.
    cryEl.fire("ended");

    // Flush microtasks (awaitCryEnd resolves here, sequential code continues).
    await Promise.resolve();
    await Promise.resolve();
    // TTS has just started but waitForAudio has not resolved yet because it
    // still needs to yield a macrotask and then await TTS.
    expect(resolved).toBe(false);
    expect(isSpeaking).toBe(true);

    // Advance past the setTimeout(0) yield inside waitForAudio.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    // awaitTtsEnd is now polling. TTS is still speaking — not resolved yet.
    expect(resolved).toBe(false);

    // TTS finishes; next poll tick resolves waitForAudio.
    isSpeaking = false;
    await vi.advanceTimersByTimeAsync(50); // one poll interval
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
