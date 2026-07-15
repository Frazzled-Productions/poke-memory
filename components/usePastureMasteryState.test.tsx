/**
 * Hook tests for usePastureMasteryState (issue #1516).
 *
 * Covers:
 *   - No session: showPasture is false.
 *   - Session with mastered cards: showPasture is true after load.
 *   - KEY_HAS_MASTERED fast path: showPasture=true without full IDB load.
 *   - pretendAllMastered superuser flag forces showPasture=true.
 *   - SETTINGS_SAVED_EVENT re-runs the mastery derivation.
 *   - Epoch catch-up: a rAF load is triggered when the write epoch has
 *     advanced between effect runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks - must be declared before the import under test.
// ---------------------------------------------------------------------------

const mockLoadSession = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => mockLoadSession(),
  STORAGE_KEY: "poke-memory:review-session:v1",
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));

const mockFilterMastered = vi.fn().mockReturnValue([]);
vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: (...args: unknown[]) => mockFilterMastered(...args),
}));

const mockLoadSettings = vi.fn(() => ({ masteryRepetitions: 3 }));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn().mockReturnValue(0),
}));

const mockUseSuperuser = vi.fn(() => ({ flags: { pretendAllMastered: false } }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

// ---------------------------------------------------------------------------

import { usePastureMasteryState } from "@/lib/pasture/usePastureMasteryState";
import { KEY_HAS_MASTERED } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// localStorage stub - jsdom does not always ship one.
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

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
  // Reset the epoch counter on window.
  (window as Window & { __pokeMemorySessionWriteEpoch?: number }).__pokeMemorySessionWriteEpoch = 0;
  mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
  mockLoadSession.mockResolvedValue(null);
  mockFilterMastered.mockReturnValue([]);
  mockLoadSettings.mockReturnValue({ masteryRepetitions: 3 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("usePastureMasteryState - no session", () => {
  it("returns showPasture=false when loadSession returns null", async () => {
    mockLoadSession.mockResolvedValue(null);

    const { result } = renderHook(() => usePastureMasteryState());

    await waitFor(() => {
      expect(result.current.showPasture).toBe(false);
    });
  });
});

describe("usePastureMasteryState - populated session", () => {
  it("returns showPasture=true after loadSession resolves with mastered cards", async () => {
    mockLoadSession.mockResolvedValue({ cards: [{ id: 1 }] });
    mockFilterMastered.mockReturnValue([{ id: 1 }]);

    const { result } = renderHook(() => usePastureMasteryState());

    await waitFor(() => {
      expect(result.current.showPasture).toBe(true);
    });
  });

  it("returns showPasture=false when session exists but filterMastered returns empty", async () => {
    mockLoadSession.mockResolvedValue({ cards: [{ id: 1 }] });
    mockFilterMastered.mockReturnValue([]);

    const { result } = renderHook(() => usePastureMasteryState());

    await waitFor(() => {
      expect(result.current.showPasture).toBe(false);
    });
  });
});

describe("usePastureMasteryState - KEY_HAS_MASTERED fast path", () => {
  it("returns showPasture=true immediately when localStorage flag is 'true'", async () => {
    localStorage.setItem(KEY_HAS_MASTERED, "true");

    const { result } = renderHook(() => usePastureMasteryState());

    await waitFor(() => {
      expect(result.current.showPasture).toBe(true);
    });
    // The fast path means loadSession is never called.
    expect(mockLoadSession).not.toHaveBeenCalled();
  });
});

describe("usePastureMasteryState - superuser flag", () => {
  it("returns showPasture=true when pretendAllMastered is on regardless of session", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });
    mockLoadSession.mockResolvedValue(null);
    mockFilterMastered.mockReturnValue([]);

    const { result } = renderHook(() => usePastureMasteryState());

    // showPasture is derived synchronously from the flag, so no waitFor needed
    // for the flag itself - but we await to let any async load settle.
    await waitFor(() => {
      expect(result.current.showPasture).toBe(true);
    });
  });
});

describe("usePastureMasteryState - SETTINGS_SAVED_EVENT re-derivation", () => {
  it("re-runs mastery check when SETTINGS_SAVED_EVENT fires and returns updated showPasture", async () => {
    // Initially nothing mastered.
    mockLoadSession.mockResolvedValue({ cards: [] });
    mockFilterMastered.mockReturnValue([]);

    const { result } = renderHook(() => usePastureMasteryState());

    await waitFor(() => {
      expect(result.current.showPasture).toBe(false);
    });

    // User lowers the threshold - filterMastered now returns a mastered card.
    mockFilterMastered.mockReturnValue([{ id: 1 }]);
    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      expect(result.current.showPasture).toBe(true);
    });
  });
});

describe("usePastureMasteryState - null localStorage (#1952)", () => {
  it("falls back to the full IDB check without throwing when window.localStorage is null", async () => {
    Object.defineProperty(window, "localStorage", {
      value: null,
      configurable: true,
      writable: true,
    });
    mockLoadSession.mockResolvedValue({ cards: [{ id: 1 }] });
    mockFilterMastered.mockReturnValue([{ id: 1 }]);

    let result: { current: { showPasture: boolean } };
    expect(() => {
      ({ result } = renderHook(() => usePastureMasteryState()));
    }).not.toThrow();

    await waitFor(() => {
      expect(result.current.showPasture).toBe(true);
    });
  });
});

describe("usePastureMasteryState - epoch catch-up guard", () => {
  it("schedules a rAF load when the write epoch has advanced since last attach", async () => {
    // Advance the epoch to simulate a write that happened before the effect
    // registered its listener (e.g. the E2E seed fires before React hydrates).
    (window as Window & { __pokeMemorySessionWriteEpoch?: number }).__pokeMemorySessionWriteEpoch = 5;

    // First direct load returns null so showPasture stays false; only the
    // rAF-triggered re-load can flip it to true - proving the epoch guard is
    // what fires the rAF, not the unconditional void load() call.
    mockLoadSession
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ cards: [{ id: 1 }] });
    mockFilterMastered.mockReturnValue([{ id: 1 }]);

    const originalRaf = window.requestAnimationFrame;
    const rafSpy = vi.fn((cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    try {
      const { result } = renderHook(() => usePastureMasteryState());

      await waitFor(() => {
        expect(result.current.showPasture).toBe(true);
      });

      expect(rafSpy).toHaveBeenCalledOnce();
    } finally {
      vi.stubGlobal("requestAnimationFrame", originalRaf);
    }
  });
});
