/**
 * Tests for FunnelTracker (#1667).
 *
 * Covers:
 *   - toProgressBucket: bucket boundaries and all four bucket labels.
 *   - readTotalMasteredCount: reads from the localStorage cache.
 *   - hasPriorLocalProgress: presence / absence of poke-memory: keys.
 *   - FunnelTracker component: all three userType values, boundary progress
 *     buckets, fires exactly once, fires after auth resolves.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import React from "react";

// -----------------------------------------------------------------
// Mocks - vi.hoisted() ensures variables are available before vi.mock factories run.
// -----------------------------------------------------------------

const { mockTrack, mockUseAuth, mockReadMasteredCountCache } = vi.hoisted(() => ({
  mockTrack: vi.fn(),
  mockUseAuth: vi.fn(),
  mockReadMasteredCountCache: vi.fn(),
}));

vi.mock("@vercel/analytics", () => ({ track: mockTrack }));
vi.mock("@/lib/auth/AuthContext", () => ({ useAuth: mockUseAuth }));
vi.mock("@/lib/profile/masteredCountCache", () => ({
  readMasteredCountCache: mockReadMasteredCountCache,
}));

// -----------------------------------------------------------------
// Imports (after mocks)
// -----------------------------------------------------------------

import {
  toProgressBucket,
  readTotalMasteredCount,
  hasPriorLocalProgress,
  FunnelTracker,
} from "./FunnelTracker";
import {
  KEY_LAST_SEEN_VERSION,
  KEY_MASTERED_COUNT_BY_LOCALE,
} from "@/lib/storage/keys";

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

/** Set up localStorage with the given keys (value "1") before a test. */
function setLocalStorageKeys(keys: string[]) {
  for (const k of keys) {
    window.localStorage.setItem(k, "1");
  }
}

function clearAllLocalStorage() {
  window.localStorage.clear();
}

// -----------------------------------------------------------------
// toProgressBucket
// -----------------------------------------------------------------

describe("toProgressBucket", () => {
  it("returns '0' for zero", () => {
    expect(toProgressBucket(0)).toBe("0");
  });

  it("returns '0' for negative numbers (guard)", () => {
    expect(toProgressBucket(-5)).toBe("0");
  });

  it("returns '1-10' for 1", () => {
    expect(toProgressBucket(1)).toBe("1-10");
  });

  it("returns '1-10' for 10 (inclusive upper boundary)", () => {
    expect(toProgressBucket(10)).toBe("1-10");
  });

  it("returns '11-50' for 11 (lower boundary)", () => {
    expect(toProgressBucket(11)).toBe("11-50");
  });

  it("returns '11-50' for 50 (inclusive upper boundary)", () => {
    expect(toProgressBucket(50)).toBe("11-50");
  });

  it("returns '50+' for 51 (lower boundary)", () => {
    expect(toProgressBucket(51)).toBe("50+");
  });

  it("returns '50+' for large counts", () => {
    expect(toProgressBucket(1025)).toBe("50+");
  });
});

// -----------------------------------------------------------------
// readTotalMasteredCount
// -----------------------------------------------------------------

describe("readTotalMasteredCount", () => {
  afterEach(() => {
    mockReadMasteredCountCache.mockReset();
  });

  it("returns 0 when all locale counts are 0", () => {
    mockReadMasteredCountCache.mockReturnValue({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    expect(readTotalMasteredCount()).toBe(0);
  });

  it("returns 0 when readMasteredCountCache returns its zero-object (absent-key / not-yet-populated path)", () => {
    // readMasteredCountCache documents that callers must treat the all-zero
    // object as "not yet populated". This test pins the assumption that
    // readTotalMasteredCount() correctly returns 0 in that case.
    mockReadMasteredCountCache.mockReturnValue({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    expect(readTotalMasteredCount()).toBe(0);
  });

  it("returns the maximum single-locale count (not sum) across locales", () => {
    mockReadMasteredCountCache.mockReturnValue({
      en: 10,
      ja: 5,
      "zh-Hans": 3,
      "zh-Hant": 2,
    });
    expect(readTotalMasteredCount()).toBe(10);
  });

  it("does not double-count species mastered in multiple locales", () => {
    // A user who has mastered 42 species in both English and Japanese has
    // not mastered 84 unique species — the peak locale count is the correct proxy.
    mockReadMasteredCountCache.mockReturnValue({
      en: 42,
      ja: 42,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    expect(readTotalMasteredCount()).toBe(42);
  });

  it("handles a cache with only English counts", () => {
    mockReadMasteredCountCache.mockReturnValue({
      en: 15,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    expect(readTotalMasteredCount()).toBe(15);
  });
});

// -----------------------------------------------------------------
// hasPriorLocalProgress
// -----------------------------------------------------------------

describe("hasPriorLocalProgress", () => {
  beforeEach(() => clearAllLocalStorage());
  afterEach(() => clearAllLocalStorage());

  it("returns false when localStorage is empty", () => {
    expect(hasPriorLocalProgress()).toBe(false);
  });

  it("returns false when only the superuser key is present", () => {
    setLocalStorageKeys(["poke-memory:superuser"]);
    expect(hasPriorLocalProgress()).toBe(false);
  });

  it("returns false when only a superuser flags key is present", () => {
    setLocalStorageKeys(["poke-memory:superuser:flags:v1"]);
    expect(hasPriorLocalProgress()).toBe(false);
  });

  it("returns false when only the last-seen-version key is present (written by WhatsNewIndicator on first visit)", () => {
    setLocalStorageKeys([KEY_LAST_SEEN_VERSION]);
    expect(hasPriorLocalProgress()).toBe(false);
  });

  it("returns true when the review session key is present", () => {
    setLocalStorageKeys(["poke-memory:review-session:v1"]);
    expect(hasPriorLocalProgress()).toBe(true);
  });

  it("returns true when the settings key is present", () => {
    setLocalStorageKeys(["poke-memory:settings:v1"]);
    expect(hasPriorLocalProgress()).toBe(true);
  });

  it("returns true when the mastered-count cache key is present", () => {
    setLocalStorageKeys([KEY_MASTERED_COUNT_BY_LOCALE]);
    expect(hasPriorLocalProgress()).toBe(true);
  });

  it("returns false when only non-poke-memory keys are present", () => {
    setLocalStorageKeys(["some-other-app:key", "unrelated"]);
    expect(hasPriorLocalProgress()).toBe(false);
  });

  it("returns true when multiple poke-memory keys are present", () => {
    setLocalStorageKeys([
      "poke-memory:review-session:v1",
      "poke-memory:streak:v1",
    ]);
    expect(hasPriorLocalProgress()).toBe(true);
  });
});

// -----------------------------------------------------------------
// FunnelTracker component
// -----------------------------------------------------------------

describe("FunnelTracker component", () => {
  beforeEach(() => {
    mockTrack.mockReset();
    mockReadMasteredCountCache.mockReset();
    clearAllLocalStorage();
  });

  afterEach(() => {
    clearAllLocalStorage();
  });

  // Helper: render FunnelTracker with a given auth state and mastered counts.
  function renderTracker({
    user = null,
    loading = false,
    masteredCounts = { en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 },
  }: {
    user?: object | null;
    loading?: boolean;
    masteredCounts?: {
      en: number;
      ja: number;
      "zh-Hans": number;
      "zh-Hant": number;
    };
  } = {}) {
    (mockUseAuth as Mock).mockReturnValue({ user, loading });
    mockReadMasteredCountCache.mockReturnValue(masteredCounts);
    return render(<FunnelTracker />);
  }

  it("fires app_open with userType='new' and progressBucket='0' for a fresh session", async () => {
    renderTracker({ user: null, loading: false });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith("app_open", {
      userType: "new",
      progressBucket: "0",
    });
  });

  it("fires app_open with userType='returning_guest' when prior localStorage progress exists", async () => {
    setLocalStorageKeys(["poke-memory:review-session:v1"]);
    renderTracker({ user: null, loading: false });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith("app_open", {
      userType: "returning_guest",
      progressBucket: "0",
    });
  });

  it("fires app_open with userType='signed_in' when auth resolves a user", async () => {
    renderTracker({ user: { id: "usr-1" }, loading: false });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith("app_open", {
      userType: "signed_in",
      progressBucket: "0",
    });
  });

  it("uses progressBucket='1-10' when total mastered is 7", async () => {
    renderTracker({
      user: null,
      masteredCounts: { en: 7, ja: 0, "zh-Hans": 0, "zh-Hant": 0 },
    });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith(
      "app_open",
      expect.objectContaining({ progressBucket: "1-10" }),
    );
  });

  it("uses progressBucket='11-50' when peak locale mastered is 25", async () => {
    renderTracker({
      user: null,
      masteredCounts: { en: 25, ja: 0, "zh-Hans": 0, "zh-Hant": 0 },
    });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith(
      "app_open",
      expect.objectContaining({ progressBucket: "11-50" }),
    );
  });

  it("uses progressBucket='50+' when total mastered is 60", async () => {
    renderTracker({
      user: null,
      masteredCounts: { en: 60, ja: 0, "zh-Hans": 0, "zh-Hant": 0 },
    });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    expect(mockTrack).toHaveBeenCalledWith(
      "app_open",
      expect.objectContaining({ progressBucket: "50+" }),
    );
  });

  it("does not fire while auth is loading", async () => {
    renderTracker({ user: null, loading: true });
    // Allow a tick for effects to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("fires once auth loading resolves", async () => {
    const { rerender } = renderTracker({ user: null, loading: true });
    // Still loading; no event yet.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockTrack).not.toHaveBeenCalled();

    // Resolve loading.
    (mockUseAuth as Mock).mockReturnValue({ user: null, loading: false });
    rerender(<FunnelTracker />);
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
  });

  it("fires exactly once even if the component re-renders", async () => {
    const { rerender } = renderTracker({ user: null, loading: false });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));

    // Re-render with updated auth (simulates a state change after initial load).
    (mockUseAuth as Mock).mockReturnValue({ user: { id: "usr-2" }, loading: false });
    rerender(<FunnelTracker />);

    // Allow another tick.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // Must not have fired again.
    expect(mockTrack).toHaveBeenCalledTimes(1);
  });

  it("renders null (nothing visible in the DOM)", () => {
    (mockUseAuth as Mock).mockReturnValue({ user: null, loading: false });
    mockReadMasteredCountCache.mockReturnValue({
      en: 0,
      ja: 0,
      "zh-Hans": 0,
      "zh-Hant": 0,
    });
    const { container } = render(<FunnelTracker />);
    expect(container.firstChild).toBeNull();
  });

  it("event properties do not contain raw counts or user IDs", async () => {
    renderTracker({
      user: { id: "real-user-id-abc123" },
      masteredCounts: { en: 42, ja: 0, "zh-Hans": 0, "zh-Hant": 0 },
    });
    await waitFor(() => expect(mockTrack).toHaveBeenCalledTimes(1));
    const [eventName, props] = mockTrack.mock.calls[0] as [string, Record<string, unknown>];
    expect(eventName).toBe("app_open");
    // Must not include any raw count or the real user ID.
    expect(Object.values(props)).not.toContain(42);
    expect(Object.values(props)).not.toContain("real-user-id-abc123");
    // Must only be the two allowed bucketed props.
    expect(Object.keys(props).sort()).toEqual(["progressBucket", "userType"]);
  });
});
