/**
 * Component tests for useSpeciesMasteryDate (#1956, rescoped: derive, don't
 * store).
 *
 * Covers:
 *   - Resolves to the date for a species present in the map (recoverable crossing).
 *   - Resolves to null for a species absent from the map (unrecoverable crossing).
 *   - Plumbs `forceAllMastered` through to `buildSpeciesMasteryDates`.
 *   - The underlying replay (`loadGradeLog` + `buildSpeciesMasteryDates`) runs
 *     ONCE and is shared across multiple species lookups for the same
 *     (locale, forceAllMastered) combination - not re-run per species.
 *   - The shared cache is invalidated by GRADE_LOG_APPENDED_EVENT (a fresh
 *     grade must not serve a stale replay).
 *
 * Each test uses a distinct locale/forceAllMastered combination to avoid
 * colliding with the module-level cache another test already populated.
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoadGradeLog = vi.fn(() => Promise.resolve([]));
vi.mock("@/lib/gradelog/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gradelog/persistence")>()),
  loadGradeLog: () => mockLoadGradeLog(),
}));

const mockBuildSpeciesMasteryDates = vi.fn(() => new Map<number, string>());
vi.mock("@/lib/timeline/reconstruct", () => ({
  buildSpeciesMasteryDates: (
    ...args: Parameters<typeof mockBuildSpeciesMasteryDates>
  ) => mockBuildSpeciesMasteryDates(...args),
}));

import { GRADE_LOG_APPENDED_EVENT } from "@/lib/gradelog/persistence";
import { useSpeciesMasteryDate } from "@/lib/timeline/useSpeciesMasteryDate";

beforeEach(() => {
  mockLoadGradeLog.mockClear();
  mockBuildSpeciesMasteryDates.mockReset();
  mockBuildSpeciesMasteryDates.mockReturnValue(new Map());
});

describe("useSpeciesMasteryDate", () => {
  it("resolves the date for a species present in the map (recoverable crossing)", async () => {
    mockBuildSpeciesMasteryDates.mockReturnValue(
      new Map([[1, "2026-03-27"]]),
    );
    const { result } = renderHook(() => useSpeciesMasteryDate(1, "en", false));

    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("2026-03-27"));
  });

  it("resolves to null for a species absent from the map (unrecoverable crossing)", async () => {
    mockBuildSpeciesMasteryDates.mockReturnValue(new Map());
    const { result } = renderHook(() =>
      useSpeciesMasteryDate(999, "ja", false),
    );

    await waitFor(() => expect(mockBuildSpeciesMasteryDates).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("plumbs forceAllMastered through to buildSpeciesMasteryDates", async () => {
    renderHook(() => useSpeciesMasteryDate(1, "zh-Hans", true));

    await waitFor(() =>
      expect(mockBuildSpeciesMasteryDates).toHaveBeenCalledWith(
        expect.objectContaining({ forceAllMastered: true, locale: "zh-Hans" }),
      ),
    );
  });

  it("computes the replay ONCE and shares it across multiple species for the same combination", async () => {
    mockBuildSpeciesMasteryDates.mockReturnValue(
      new Map([
        [1, "2026-01-15"],
        [2, "2026-02-20"],
      ]),
    );

    const first = renderHook(() =>
      useSpeciesMasteryDate(1, "zh-Hant", false),
    );
    await waitFor(() => expect(first.result.current).toBe("2026-01-15"));

    const callsAfterFirst = mockLoadGradeLog.mock.calls.length;

    const second = renderHook(() =>
      useSpeciesMasteryDate(2, "zh-Hant", false),
    );
    await waitFor(() => expect(second.result.current).toBe("2026-02-20"));

    // The second species lookup reused the cached replay - no additional
    // loadGradeLog call.
    expect(mockLoadGradeLog.mock.calls.length).toBe(callsAfterFirst);
  });

  it("invalidates the shared cache on GRADE_LOG_APPENDED_EVENT", async () => {
    mockBuildSpeciesMasteryDates.mockReturnValue(new Map([[1, "2026-04-01"]]));

    const first = renderHook(() => useSpeciesMasteryDate(1, "en", false));
    await waitFor(() => expect(first.result.current).toBe("2026-04-01"));
    const callsBeforeEvent = mockLoadGradeLog.mock.calls.length;

    act(() => {
      window.dispatchEvent(new CustomEvent(GRADE_LOG_APPENDED_EVENT));
    });

    mockBuildSpeciesMasteryDates.mockReturnValue(new Map([[1, "2026-05-01"]]));
    const second = renderHook(() => useSpeciesMasteryDate(1, "en", false));
    await waitFor(() => expect(second.result.current).toBe("2026-05-01"));

    // A fresh loadGradeLog call happened after the invalidating event.
    expect(mockLoadGradeLog.mock.calls.length).toBeGreaterThan(
      callsBeforeEvent,
    );
  });
});
