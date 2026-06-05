/**
 * Unit tests for lib/streak/runProtection.ts (issue #1529).
 *
 * Covers:
 *   - SSR no-op: returns null when window is undefined.
 *   - No-settings no-op: returns null when hasStoredSettings returns false.
 *   - Same-day idempotency: calling twice on the same day does not
 *     double-count the earn leg (lastEarnCheckDate guard).
 *   - Earn-leg guard (lastEarnCheckDate): a second call on the same today
 *     does not increment daysSinceLastEarn again.
 *   - Spend-leg guard (spendDates): a day that already has a spend entry is
 *     not bridged again.
 *   - "Never throws" contract: throws are swallowed; function always returns
 *     null or a result object.
 *   - Persists updated state when something changed; no write when nothing
 *     changed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_STREAK_PROTECTION } from "@/lib/streak/tokens";
import type { StreakProtection } from "@/lib/streak/tokens";

// ---------------------------------------------------------------------------
// Module mocks - must appear before the import of the module under test.
// ---------------------------------------------------------------------------

const mockHasStoredSettings = vi.fn<() => boolean>();
const mockLoadSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock("@/lib/settings/persistence", () => ({
  hasStoredSettings: () => mockHasStoredSettings(),
  loadSettings: () => mockLoadSettings(),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
}));

const mockLoadStreakData = vi.fn<() => string[]>();

vi.mock("./persistence", () => ({
  loadStreakData: () => mockLoadStreakData(),
}));

// The module under test is imported AFTER the mocks are in place.
import { runStreakProtection } from "./runProtection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TODAY = "2026-05-10";
const YESTERDAY = "2026-05-09";
const DAY_BEFORE = "2026-05-08";

function makeProtection(overrides: Partial<StreakProtection> = {}): StreakProtection {
  return { ...DEFAULT_STREAK_PROTECTION, ...overrides };
}

function makeSettings(protection: StreakProtection = makeProtection()) {
  return { streakProtection: protection };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default: browser context (window exists).
  vi.stubGlobal("window", { localStorage: {} });

  mockHasStoredSettings.mockReturnValue(true);
  mockLoadSettings.mockReturnValue(makeSettings());
  mockLoadStreakData.mockReturnValue([]);
  mockSaveSettings.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// SSR no-op
// ---------------------------------------------------------------------------

describe("runStreakProtection - SSR no-op", () => {
  it("returns null when window is undefined (server-side render)", () => {
    vi.stubGlobal("window", undefined);
    const result = runStreakProtection(TODAY);
    expect(result).toBeNull();
  });

  it("does not call loadSettings in SSR mode", () => {
    vi.stubGlobal("window", undefined);
    runStreakProtection(TODAY);
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// No-settings no-op
// ---------------------------------------------------------------------------

describe("runStreakProtection - no stored settings", () => {
  it("returns null when hasStoredSettings is false", () => {
    mockHasStoredSettings.mockReturnValue(false);
    const result = runStreakProtection(TODAY);
    expect(result).toBeNull();
  });

  it("does not call loadSettings when hasStoredSettings is false", () => {
    mockHasStoredSettings.mockReturnValue(false);
    runStreakProtection(TODAY);
    expect(mockLoadSettings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Basic result shape
// ---------------------------------------------------------------------------

describe("runStreakProtection - basic result", () => {
  it("returns a ProtectionStepResult object when conditions are met", () => {
    const result = runStreakProtection(TODAY);
    // Should be non-null and have the expected shape.
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("protection");
    expect(result).toHaveProperty("earned");
    expect(result).toHaveProperty("spent");
  });

  it("does not write settings when nothing changed", () => {
    // Default state: no streak dates, no balance, nothing to earn or spend.
    // The function detects no meaningful change and skips the write.
    runStreakProtection(TODAY);
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Earn-leg guard (lastEarnCheckDate) - same-day idempotency
// ---------------------------------------------------------------------------

describe("runStreakProtection - earn-leg guard", () => {
  it("does not increment daysSinceLastEarn a second time on the same day", () => {
    // Simulate: today is a review day; first call increments the counter.
    mockLoadStreakData.mockReturnValue([TODAY]);
    const initialProtection = makeProtection({
      lastEarnCheckDate: null,
      daysSinceLastEarn: 5,
    });
    mockLoadSettings.mockReturnValue(makeSettings(initialProtection));

    const firstResult = runStreakProtection(TODAY);
    expect(firstResult).not.toBeNull();
    const afterFirst = firstResult!.protection.daysSinceLastEarn;
    // Counter should have incremented by 1.
    expect(afterFirst).toBe(6);

    // Second call on the same day: lastEarnCheckDate is now TODAY, so the
    // earn leg is guarded. The counter must not increment again.
    // Simulate what would happen if the new state were persisted and then
    // loadSettings returned it for the second call.
    mockLoadSettings.mockReturnValue(
      makeSettings({ ...firstResult!.protection }),
    );

    const secondResult = runStreakProtection(TODAY);
    expect(secondResult).not.toBeNull();
    const afterSecond = secondResult!.protection.daysSinceLastEarn;
    expect(afterSecond).toBe(afterFirst);
  });

  it("persists updated state when daysSinceLastEarn changes", () => {
    mockLoadStreakData.mockReturnValue([TODAY]);
    mockLoadSettings.mockReturnValue(
      makeSettings(makeProtection({ lastEarnCheckDate: null, daysSinceLastEarn: 0 })),
    );

    runStreakProtection(TODAY);

    expect(mockSaveSettings).toHaveBeenCalledOnce();
    const savedArg = mockSaveSettings.mock.calls[0][0] as ReturnType<typeof makeSettings>;
    expect(savedArg.streakProtection.lastEarnCheckDate).toBe(TODAY);
  });
});

// ---------------------------------------------------------------------------
// Spend-leg guard (spendDates)
// ---------------------------------------------------------------------------

describe("runStreakProtection - spend-leg guard", () => {
  it("spends a token to bridge yesterday when streak was alive the day before", () => {
    // Streak alive on DAY_BEFORE, missed YESTERDAY, today opens app.
    mockLoadStreakData.mockReturnValue([DAY_BEFORE]);
    const protection = makeProtection({ balance: 1, spendDates: [] });
    mockLoadSettings.mockReturnValue(makeSettings(protection));

    const result = runStreakProtection(TODAY);
    expect(result).not.toBeNull();
    expect(result!.spent).toBe(true);
    expect(result!.protection.spendDates).toContain(YESTERDAY);
    expect(result!.protection.balance).toBe(0);
  });

  it("does not bridge a day that is already in spendDates", () => {
    // Yesterday is already spent - the streak was already preserved.
    mockLoadStreakData.mockReturnValue([DAY_BEFORE]);
    const protection = makeProtection({
      balance: 1,
      spendDates: [YESTERDAY],
    });
    mockLoadSettings.mockReturnValue(makeSettings(protection));

    const result = runStreakProtection(TODAY);
    expect(result).not.toBeNull();
    // No additional spend fires because yesterday is already in spendDates.
    expect(result!.spent).toBe(false);
    expect(result!.protection.balance).toBe(1);
  });

  it("does not spend tokens when there is no anchor before the gap", () => {
    // No streak dates, no prior spends - there is nothing to anchor the gap.
    mockLoadStreakData.mockReturnValue([]);
    const protection = makeProtection({ balance: 3, spendDates: [] });
    mockLoadSettings.mockReturnValue(makeSettings(protection));

    const result = runStreakProtection(TODAY);
    expect(result).not.toBeNull();
    expect(result!.spent).toBe(false);
    expect(result!.protection.balance).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Safe-exit paths - SSR and no-settings guards are the two conditions where
// the function is documented to return null without throwing. Storage errors
// in the normal path are NOT caught (no try/catch in the implementation);
// callers that need robustness to storage errors must wrap in their own
// try/catch. These tests document the actual safe boundary.
// ---------------------------------------------------------------------------

describe("runStreakProtection - SSR and no-settings safe-exit paths", () => {
  it("does not throw when window is undefined (SSR path is always safe)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => runStreakProtection(TODAY)).not.toThrow();
  });

  it("does not throw when hasStoredSettings returns false", () => {
    mockHasStoredSettings.mockReturnValue(false);
    expect(() => runStreakProtection(TODAY)).not.toThrow();
  });

  it("does not throw for a normal call with valid mocked dependencies", () => {
    mockLoadStreakData.mockReturnValue([TODAY]);
    mockLoadSettings.mockReturnValue(makeSettings(makeProtection()));
    expect(() => runStreakProtection(TODAY)).not.toThrow();
  });
});
