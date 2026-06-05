import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class MockAudio {
  src = "";
  volume = 1;
  currentTime = 0;
  loop = false;
  paused = true;
  private listeners: Record<string, Array<() => void>> = {};
  playMock: () => Promise<void> = () => Promise.resolve();

  pause(): void {
    this.paused = true;
  }

  play(): Promise<void> {
    this.paused = false;
    return this.playMock();
  }

  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    const arr = this.listeners[type] ?? [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  fire(type: string): void {
    [...(this.listeners[type] ?? [])].forEach((f) => f());
  }

  listenerCount(type: string): number {
    return (this.listeners[type] ?? []).length;
  }
}

const audioInstances: MockAudio[] = [];
let nextPlayBehaviour: (() => Promise<void>) | null = null;

class AudioMock extends MockAudio {
  constructor() {
    super();
    if (nextPlayBehaviour !== null) {
      this.playMock = nextPlayBehaviour;
      nextPlayBehaviour = null;
    }
    audioInstances.push(this);
  }
}

function currentAudio(): MockAudio {
  if (audioInstances.length === 0) throw new Error("no Audio constructed");
  return audioInstances[audioInstances.length - 1];
}

async function flushMicrotasks(): Promise<void> {
  // Two awaits cover the .catch() handler chained after play().
  await Promise.resolve();
  await Promise.resolve();
}

describe("playCry", () => {
  beforeEach(() => {
    vi.resetModules();
    audioInstances.length = 0;
    nextPlayBehaviour = null;
    vi.stubGlobal("window", {});
    vi.stubGlobal("Audio", AudioMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls onEnded synchronously when url is null", async () => {
    const { playCry } = await import("./cry");
    const onEnded = vi.fn();

    playCry(null, 0.6, onEnded);

    expect(onEnded).toHaveBeenCalledOnce();
    expect(audioInstances.length).toBe(0);
  });

  it("calls onEnded only after the audio fires `ended`", async () => {
    const { playCry } = await import("./cry");
    const onEnded = vi.fn();

    playCry("/sprites/cry/1.ogg", 0.6, onEnded);
    await flushMicrotasks();

    expect(onEnded).not.toHaveBeenCalled();

    currentAudio().fire("ended");
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("removes the ended listener after it fires", async () => {
    const { playCry } = await import("./cry");
    const onEnded = vi.fn();

    playCry("/sprites/cry/1.ogg", 0.6, onEnded);
    await flushMicrotasks();
    currentAudio().fire("ended");

    // Firing again does nothing - listener was removed.
    currentAudio().fire("ended");
    expect(onEnded).toHaveBeenCalledOnce();
    expect(currentAudio().listenerCount("ended")).toBe(0);
  });

  it("drops the prior onEnded when a new playCry call arrives mid-flight", async () => {
    const { playCry } = await import("./cry");
    const firstOnEnded = vi.fn();
    const secondOnEnded = vi.fn();

    playCry("/sprites/cry/1.ogg", 0.6, firstOnEnded);
    await flushMicrotasks();

    // Second call replaces the chain on the same (singleton) audio element.
    playCry("/sprites/cry/2.ogg", 0.6, secondOnEnded);
    await flushMicrotasks();

    currentAudio().fire("ended");

    expect(firstOnEnded).not.toHaveBeenCalled();
    expect(secondOnEnded).toHaveBeenCalledOnce();
  });

  it("fires onEnded when play() rejects with NotAllowedError (autoplay blocked)", async () => {
    nextPlayBehaviour = () =>
      Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
    const { playCry } = await import("./cry");
    const onEnded = vi.fn();

    playCry("/sprites/cry/1.ogg", 0.6, onEnded);
    await flushMicrotasks();

    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("does not call onEnded when no callback was supplied", async () => {
    const { playCry } = await import("./cry");

    expect(() => playCry("/sprites/cry/1.ogg")).not.toThrow();
    await flushMicrotasks();
    expect(currentAudio().listenerCount("ended")).toBe(0);
  });
});
