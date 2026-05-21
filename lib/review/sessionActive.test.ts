/**
 * Unit tests for the shared review-session-active flag.
 *
 * Runs in the node vitest project (no DOM), so `window` is stubbed per test
 * to exercise both the SSR guard and the localStorage paths.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSessionActive,
  markSessionActive,
  markSessionInactive,
} from "./sessionActive";
import { KEY_REVIEW_SESSION_ACTIVE } from "@/lib/storage/keys";

function makeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => {
      data.clear();
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sessionActive — SSR guard", () => {
  it("isSessionActive returns false when window is undefined", () => {
    expect(isSessionActive()).toBe(false);
  });

  it("markSessionActive is a no-op when window is undefined", () => {
    expect(() => markSessionActive()).not.toThrow();
  });

  it("markSessionInactive is a no-op when window is undefined", () => {
    expect(() => markSessionInactive()).not.toThrow();
  });
});

describe("sessionActive — browser path", () => {
  it("markSessionActive sets the flag and isSessionActive reads it", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(false);
    markSessionActive();
    expect(isSessionActive()).toBe(true);
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBe("1");
  });

  it("markSessionInactive clears the flag", () => {
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "1" });
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(true);
    markSessionInactive();
    expect(isSessionActive()).toBe(false);
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBeNull();
  });

  it("markSessionActive is idempotent", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    markSessionActive();
    markSessionActive();
    expect(isSessionActive()).toBe(true);
  });

  it("isSessionActive returns false for any value other than the active marker", () => {
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "0" });
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(false);
  });
});

describe("sessionActive — storage failures", () => {
  it("markSessionActive swallows setItem errors", () => {
    vi.stubGlobal("window", {
      localStorage: {
        ...makeStorage(),
        setItem: () => {
          throw new Error("quota exceeded");
        },
      } as Storage,
    });

    expect(() => markSessionActive()).not.toThrow();
  });

  it("markSessionInactive swallows removeItem errors", () => {
    vi.stubGlobal("window", {
      localStorage: {
        ...makeStorage(),
        removeItem: () => {
          throw new Error("storage disabled");
        },
      } as Storage,
    });

    expect(() => markSessionInactive()).not.toThrow();
  });

  it("isSessionActive returns false when getItem throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        ...makeStorage(),
        getItem: () => {
          throw new Error("storage disabled");
        },
      } as Storage,
    });

    expect(isSessionActive()).toBe(false);
  });
});
