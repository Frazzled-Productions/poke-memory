import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShareSheet } from "@/components/review/useShareSheet";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/streak", () => ({
  computeStreak: vi.fn(() => 5),
  effectiveStreakDates: vi.fn((dates: string[]) => dates),
  loadStreakData: vi.fn(() => []),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ streakProtection: { spendDates: [] } })),
  saveSettings: vi.fn(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
  DEFAULT_ONBOARDING: {},
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useShareSheet — empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for both parts and text when gradeSeq is empty", () => {
    const { result } = renderHook(() =>
      useShareSheet([], 0, 0, "UTC"),
    );
    expect(result.current.shareParts).toBeNull();
    expect(result.current.shareText).toBeNull();
  });
});

describe("useShareSheet — populated state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns non-null parts and text when gradeSeq has at least one grade", () => {
    const { result } = renderHook(() =>
      useShareSheet([4, 5, 1], 2, 1, "UTC"),
    );
    expect(result.current.shareParts).not.toBeNull();
    expect(result.current.shareText).not.toBeNull();
  });

  it("shareParts.reviewed equals gradeSeq.length", () => {
    const { result } = renderHook(() =>
      useShareSheet([4, 5, 1, 4], 0, 0, "UTC"),
    );
    expect(result.current.shareParts?.reviewed).toBe(4);
  });

  it("shareParts.gradeSequence matches the input sequence", () => {
    const seq = [1, 4, 5, 2] as const;
    const { result } = renderHook(() =>
      useShareSheet([...seq], 0, 0, "UTC"),
    );
    expect(result.current.shareParts?.gradeSequence).toEqual([1, 4, 5, 2]);
  });

  it("shareParts.newCards and mastered reflect the passed counts", () => {
    const { result } = renderHook(() =>
      useShareSheet([4], 3, 2, "UTC"),
    );
    expect(result.current.shareParts?.newCards).toBe(3);
    expect(result.current.shareParts?.mastered).toBe(2);
  });

  it("shareText is a non-empty string when gradeSeq is populated", () => {
    const { result } = renderHook(() =>
      useShareSheet([4, 4], 0, 0, "UTC"),
    );
    expect(typeof result.current.shareText).toBe("string");
    expect((result.current.shareText?.length ?? 0) > 0).toBe(true);
  });

  it("memoises — returns the same object references when inputs are unchanged", () => {
    const seq = [4, 5];
    const { result, rerender } = renderHook(
      ({ gradeSeq }) => useShareSheet(gradeSeq, 0, 0, "UTC"),
      { initialProps: { gradeSeq: seq } },
    );
    const first = result.current;
    rerender({ gradeSeq: seq }); // same reference
    expect(result.current).toBe(first);
  });

  it("recomputes when gradeSeq reference changes", () => {
    const { result, rerender } = renderHook(
      ({ gradeSeq }: { gradeSeq: (1 | 2 | 4 | 5)[] }) =>
        useShareSheet(gradeSeq, 0, 0, "UTC"),
      { initialProps: { gradeSeq: [4] as (1 | 2 | 4 | 5)[] } },
    );
    const first = result.current.shareParts;
    rerender({ gradeSeq: [4, 5] as (1 | 2 | 4 | 5)[] }); // new array with more grades
    expect(result.current.shareParts).not.toBe(first);
    expect(result.current.shareParts?.reviewed).toBe(2);
  });
});
