/**
 * Tests for `useStreakNavState` and `nextMilestoneAbove` (#1439 / #1442).
 *
 * The hook lives in lib/ but tests must live under components/ for jsdom
 * (see AGENTS.md "Testing"). All external dependencies are vi.mock'd.
 *
 * Covers:
 *   - `nextMilestoneAbove` pure helper.
 *   - Hook state coverage: 0-day streak, active streak, tokens, milestone
 *     countdown shown and suppressed.
 *   - `forceNextStreakMilestone` on: countdown suppressed.
 *   - Re-reads on STREAK_UPDATED_EVENT and SETTINGS_SAVED_EVENT.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

const mockStreakDates = vi.fn(() => [] as string[]);
const mockComputeStreak = vi.fn((_dates: string[], _today: string) => 0);
const mockEffectiveDates = vi.fn((dates: string[], spends: string[]) => [
  ...dates,
  ...spends,
]);

vi.mock("@/lib/streak", () => ({
  loadStreakData: () => mockStreakDates(),
  computeStreak: (...args: unknown[]) =>
    mockComputeStreak(args[0] as string[], args[1] as string),
  effectiveStreakDates: (...args: unknown[]) =>
    mockEffectiveDates(args[0] as string[], args[1] as string[]),
  STREAK_UPDATED_EVENT: "poke-memory:streak-updated",
}));

const mockLoadSettings = vi.fn(() => ({
  timezone: "UTC",
  streakProtection: { spendDates: [] as string[], balance: 0 },
  seenStreakMilestones: [] as number[],
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

vi.mock("@/lib/review/session", () => ({
  todayString: (_now: Date, _tz: string) => "2024-06-15",
}));

const mockUseSuperuser = vi.fn(() => ({
  flags: { forceNextStreakMilestone: false },
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

// ---------------------------------------------------------------------------

import { useStreakNavState, nextMilestoneAbove } from "@/lib/streak/useStreakNavState";

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

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
  mockStreakDates.mockReturnValue([]);
  mockComputeStreak.mockReturnValue(0);
  mockEffectiveDates.mockImplementation((d, s) => [...d, ...s]);
  mockLoadSettings.mockReturnValue({
    timezone: "UTC",
    streakProtection: { spendDates: [], balance: 0 },
    seenStreakMilestones: [],
  });
  mockUseSuperuser.mockReturnValue({ flags: { forceNextStreakMilestone: false } });
});

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("nextMilestoneAbove", () => {
  it("returns 3 for streak 0", () => {
    expect(nextMilestoneAbove(0)).toBe(3);
  });

  it("returns 7 for streak 3 (just hit first milestone)", () => {
    expect(nextMilestoneAbove(3)).toBe(7);
  });

  it("returns 7 for streak 4 (mid-range between 3 and 7)", () => {
    expect(nextMilestoneAbove(4)).toBe(7);
  });

  it("returns 14 for streak 7", () => {
    expect(nextMilestoneAbove(7)).toBe(14);
  });

  it("returns 30 for streak 14", () => {
    expect(nextMilestoneAbove(14)).toBe(30);
  });

  it("returns 465 for streak 365 (post-365 extension)", () => {
    expect(nextMilestoneAbove(365)).toBe(465);
  });

  it("returns 565 for streak 465", () => {
    expect(nextMilestoneAbove(465)).toBe(565);
  });

  it("returns the next 100-day increment for a large streak", () => {
    expect(nextMilestoneAbove(900)).toBe(965);
  });
});

// ---------------------------------------------------------------------------
// Hook tests
// ---------------------------------------------------------------------------

describe("useStreakNavState - 0-day streak state", () => {
  it("returns streak=0, tokenBalance=0, daysToNextMilestone=null when no reviews", async () => {
    mockComputeStreak.mockReturnValue(0);

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.streak).toBe(0);
    expect(result.current.tokenBalance).toBe(0);
    expect(result.current.daysToNextMilestone).toBeNull();
  });
});

describe("useStreakNavState - active streak state", () => {
  it("returns streak > 0 and daysToNextMilestone for a mid-streak user", async () => {
    mockComputeStreak.mockReturnValue(4);

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.streak).toBe(4);
    // next milestone above 4 is 7, distance = 3
    expect(result.current.daysToNextMilestone).toBe(3);
  });

  it("returns token balance from streakProtection.balance", async () => {
    mockComputeStreak.mockReturnValue(5);
    mockLoadSettings.mockReturnValue({
      timezone: "UTC",
      streakProtection: { spendDates: [], balance: 2 },
      seenStreakMilestones: [],
    });

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.tokenBalance).toBe(2);
  });

  it("returns tokenBalance=0 when streakProtection.balance is 0", async () => {
    mockComputeStreak.mockReturnValue(1);
    mockLoadSettings.mockReturnValue({
      timezone: "UTC",
      streakProtection: { spendDates: [], balance: 0 },
      seenStreakMilestones: [],
    });

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.tokenBalance).toBe(0);
  });
});

describe("useStreakNavState - forceNextStreakMilestone flag", () => {
  it("suppresses daysToNextMilestone when forceNextStreakMilestone is on", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { forceNextStreakMilestone: true } });
    mockComputeStreak.mockReturnValue(4);

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    // Countdown suppressed because forceNextStreakMilestone is on
    expect(result.current.daysToNextMilestone).toBeNull();
  });

  it("restores daysToNextMilestone when forceNextStreakMilestone turns off", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { forceNextStreakMilestone: true } });
    mockComputeStreak.mockReturnValue(4);

    const { result, rerender } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.daysToNextMilestone).toBeNull();

    // Toggle the flag off
    mockUseSuperuser.mockReturnValue({ flags: { forceNextStreakMilestone: false } });
    rerender();

    await act(async () => {});
    // Now countdown should be visible (streak=4, next milestone=7, distance=3)
    expect(result.current.daysToNextMilestone).toBe(3);
  });
});

describe("useStreakNavState - event reactivity", () => {
  it("re-reads state when STREAK_UPDATED_EVENT fires", async () => {
    mockComputeStreak.mockReturnValue(0);

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.streak).toBe(0);

    // Simulate a streak update
    mockComputeStreak.mockReturnValue(1);
    act(() => {
      window.dispatchEvent(new Event("poke-memory:streak-updated"));
    });

    await act(async () => {});
    expect(result.current.streak).toBe(1);
  });

  it("re-reads state when SETTINGS_SAVED_EVENT fires", async () => {
    mockComputeStreak.mockReturnValue(1);
    mockLoadSettings.mockReturnValue({
      timezone: "UTC",
      streakProtection: { spendDates: [], balance: 0 },
      seenStreakMilestones: [],
    });

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    expect(result.current.tokenBalance).toBe(0);

    mockLoadSettings.mockReturnValue({
      timezone: "UTC",
      streakProtection: { spendDates: [], balance: 1 },
      seenStreakMilestones: [],
    });
    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await act(async () => {});
    expect(result.current.tokenBalance).toBe(1);
  });
});

describe("useStreakNavState - immediately-after-milestone state", () => {
  it("shows next target after milestone fires (e.g. 7 achieved, next=14, distance=7)", async () => {
    mockComputeStreak.mockReturnValue(7);

    const { result } = renderHook(() => useStreakNavState());

    await act(async () => {});
    // streak=7, next milestone above 7 is 14, distance = 7
    expect(result.current.streak).toBe(7);
    expect(result.current.daysToNextMilestone).toBe(7);
  });
});
