/**
 * Component tests for useSpeciesMasteryDate (#1956, rescoped: derive, don't
 * store; #1978 review fix broadens invalidation coverage).
 *
 * Covers:
 *   - Resolves to the date for a species present in the map (recoverable crossing).
 *   - Resolves to null for a species absent from the map (unrecoverable crossing).
 *   - Plumbs `forceAllMastered` through to `buildSpeciesMasteryDates`.
 *   - The underlying replay (`loadGradeLog` + `buildSpeciesMasteryDates`) runs
 *     ONCE and is shared across multiple species lookups for the same
 *     (locale, forceAllMastered) combination - not re-run per species.
 *   - The shared cache is invalidated by GRADE_LOG_CHANGED_EVENT (fired by
 *     every write through lib/gradelog/persistence.ts - append, save/bulk
 *     overwrite from a cloud pull/merge, and remove/undo alike - a stale
 *     replay must never be served after any of them).
 *   - The shared cache is invalidated by a synthetic StorageEvent keyed to
 *     KEY_GRADE_LOG (the convention used by writers that bypass
 *     persistence.ts and touch IDB directly: a guest/superuser progress
 *     reset, and a multi-account device switch).
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

import { GRADE_LOG_CHANGED_EVENT } from "@/lib/gradelog/persistence";
import { KEY_GRADE_LOG } from "@/lib/storage/keys";
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

  it("invalidates the shared cache on GRADE_LOG_CHANGED_EVENT (covers append, save, and remove)", async () => {
    mockBuildSpeciesMasteryDates.mockReturnValue(new Map([[1, "2026-04-01"]]));

    const first = renderHook(() => useSpeciesMasteryDate(1, "en", false));
    await waitFor(() => expect(first.result.current).toBe("2026-04-01"));
    const callsBeforeEvent = mockLoadGradeLog.mock.calls.length;

    act(() => {
      window.dispatchEvent(new CustomEvent(GRADE_LOG_CHANGED_EVENT));
    });

    mockBuildSpeciesMasteryDates.mockReturnValue(new Map([[1, "2026-05-01"]]));
    const second = renderHook(() => useSpeciesMasteryDate(1, "en", false));
    await waitFor(() => expect(second.result.current).toBe("2026-05-01"));

    // A fresh loadGradeLog call happened after the invalidating event.
    expect(mockLoadGradeLog.mock.calls.length).toBeGreaterThan(
      callsBeforeEvent,
    );
  });

  it("invalidates the shared cache on a cloud pull/merge (GRADE_LOG_CHANGED_EVENT fired by saveGradeLog)", async () => {
    // Reproduces the reviewer's named scenario: lib/sync/pullAndMerge.ts calls
    // saveGradeLog(mergedLog) directly after a cloud pull/merge, which (as of
    // #1978) fires GRADE_LOG_CHANGED_EVENT - simulate that exact write path by
    // dispatching the same event saveGradeLog dispatches, proving the hook does
    // not keep serving the stale pre-merge date.
    mockBuildSpeciesMasteryDates.mockReturnValue(
      new Map([[1, "2026-01-01"]]), // stale pre-merge date
    );
    const first = renderHook(() => useSpeciesMasteryDate(1, "ja", true));
    await waitFor(() => expect(first.result.current).toBe("2026-01-01"));

    // Cloud pull/merge lands a later crossing date and calls saveGradeLog,
    // which fires GRADE_LOG_CHANGED_EVENT.
    mockBuildSpeciesMasteryDates.mockReturnValue(
      new Map([[1, "2026-06-15"]]),
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(GRADE_LOG_CHANGED_EVENT));
    });

    const second = renderHook(() => useSpeciesMasteryDate(1, "ja", true));
    await waitFor(() => expect(second.result.current).toBe("2026-06-15"));
    // The stale pre-merge date must never be what a fresh mount resolves to.
    expect(second.result.current).not.toBe("2026-01-01");
  });

  it("invalidates the shared cache on a progress reset (synthetic StorageEvent keyed to KEY_GRADE_LOG)", async () => {
    // Reproduces the reviewer's named scenario: lib/storage/reset.ts wipes the
    // IndexedDB grade log on a guest reset / superuser resetAllProgressEverywhere
    // and dispatches a StorageEvent("storage", { key: KEY_GRADE_LOG }) rather
    // than GRADE_LOG_CHANGED_EVENT (that write bypasses persistence.ts entirely).
    mockBuildSpeciesMasteryDates.mockReturnValue(
      new Map([[1, "2026-03-10"]]), // pre-reset date
    );
    const first = renderHook(() => useSpeciesMasteryDate(1, "zh-Hant", true));
    await waitFor(() => expect(first.result.current).toBe("2026-03-10"));

    // A reset wipes the log - no history left, so the replay resolves to no
    // date for this species (the fallback "Mastered" badge with no date).
    mockBuildSpeciesMasteryDates.mockReturnValue(new Map());
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY_GRADE_LOG }));
    });

    const second = renderHook(() => useSpeciesMasteryDate(1, "zh-Hant", true));
    await waitFor(() => expect(mockBuildSpeciesMasteryDates).toHaveBeenCalled());
    // A user who reset progress must not still see the stale pre-reset date.
    expect(second.result.current).toBeNull();
  });

  it("does not invalidate on an unrelated StorageEvent key", async () => {
    mockBuildSpeciesMasteryDates.mockReturnValue(
      new Map([[1, "2026-07-01"]]),
    );
    const first = renderHook(() => useSpeciesMasteryDate(1, "zh-Hans", false));
    await waitFor(() => expect(first.result.current).toBe("2026-07-01"));
    const callsBeforeEvent = mockLoadGradeLog.mock.calls.length;

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "poke-memory:settings:v1" }));
    });

    const second = renderHook(() => useSpeciesMasteryDate(1, "zh-Hans", false));
    await waitFor(() => expect(second.result.current).toBe("2026-07-01"));
    // No fresh loadGradeLog call - the cache was not invalidated.
    expect(mockLoadGradeLog.mock.calls.length).toBe(callsBeforeEvent);
  });
});
