/**
 * Unit tests for the reference-counted review-session-active flag (#1178).
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

describe("sessionActive — browser path (reference count)", () => {
  it("isSessionActive returns false when no session is active", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(false);
  });

  it("markSessionActive increments count and isSessionActive returns true", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    markSessionActive();
    expect(isSessionActive()).toBe(true);
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBe("1");
  });

  it("markSessionActive twice gives count 2", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    markSessionActive();
    markSessionActive();
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBe("2");
    expect(isSessionActive()).toBe(true);
  });

  it("markSessionInactive decrements count", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    markSessionActive();
    markSessionActive();
    markSessionInactive();
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBe("1");
    expect(isSessionActive()).toBe(true);
  });

  it("markSessionInactive clears the key when count reaches zero", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    markSessionActive();
    markSessionInactive();
    expect(isSessionActive()).toBe(false);
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBeNull();
  });

  it("markSessionInactive clamps at 0 — count never goes negative", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    markSessionInactive();
    markSessionInactive();
    expect(isSessionActive()).toBe(false);
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBeNull();
  });

  it("close-one-of-two scenario: second tab closing leaves first tab protected", () => {
    const storage = makeStorage();
    vi.stubGlobal("window", { localStorage: storage });

    // Two tabs mount ReviewSession
    markSessionActive(); // Tab A mounts
    markSessionActive(); // Tab B mounts
    expect(isSessionActive()).toBe(true);

    // Tab A closes/navigates away and calls markSessionInactive
    markSessionInactive(); // Tab A unmounts
    // Tab B still has a live session — flag must remain active
    expect(isSessionActive()).toBe(true);

    // Tab B closes too
    markSessionInactive(); // Tab B unmounts
    expect(isSessionActive()).toBe(false);
  });
});

describe("sessionActive — legacy and corrupt value handling", () => {
  it('legacy active boolean string "1" is treated as count 1 (active)', () => {
    // The old implementation stored "1" when active — parseInt("1", 10) === 1
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "1" });
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(true);
  });

  it('legacy "0" string is treated as count 0 (inactive)', () => {
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "0" });
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(false);
  });

  it("unparseable value (NaN) is treated as 0 — falls through to allow background work", () => {
    // e.g. if something wrote a non-numeric value
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "corrupt" });
    vi.stubGlobal("window", { localStorage: storage });

    expect(isSessionActive()).toBe(false);
  });

  it("markSessionActive after a corrupt value writes count 1", () => {
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "corrupt" });
    vi.stubGlobal("window", { localStorage: storage });

    // NaN treated as 0, so incrementing gives 1
    markSessionActive();
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBe("1");
    expect(isSessionActive()).toBe(true);
  });

  it("markSessionInactive after a corrupt value clamps to 0 and removes key", () => {
    const storage = makeStorage({ [KEY_REVIEW_SESSION_ACTIVE]: "corrupt" });
    vi.stubGlobal("window", { localStorage: storage });

    markSessionInactive();
    expect(isSessionActive()).toBe(false);
    expect(storage.getItem(KEY_REVIEW_SESSION_ACTIVE)).toBeNull();
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

  it("markSessionActive is a no-op when getItem throws (count stays unknowable)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        ...makeStorage(),
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => {
          throw new Error("storage disabled");
        },
        removeItem: () => {
          throw new Error("storage disabled");
        },
      } as Storage,
    });

    expect(() => markSessionActive()).not.toThrow();
    expect(() => markSessionInactive()).not.toThrow();
  });
});
