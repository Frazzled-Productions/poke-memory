/**
 * Tests for useVisibilityPull (#924 refactor).
 *
 * The hook registers a visibilitychange listener that pulls cloud state into
 * localStorage when the tab becomes visible after being hidden for >= 30 seconds,
 * the user is signed in, and the current route is not blocked.
 *
 * Lines 28-30 (the three useLatestRef calls) execute on every render and are
 * covered by all tests below.
 *
 * File lives under components/ (not lib/) because it calls renderHook, which
 * requires jsdom — the vitest jsdom project covers components/**\/*.test.tsx.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/sync/pullAndMerge", () => ({
  pullAndMerge: vi.fn(),
}));

import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { useVisibilityPull } from "@/lib/sync/useVisibilityPull";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";
const NON_BLOCKED_PATH = "/pokedex";

const HIDDEN_THRESHOLD_MS = 30_000;

/** Drive the document into hidden state and record the hide time. */
function fireHidden() {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Drive the document back to visible. */
function fireVisible() {
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useVisibilityPull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Start visible.
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // 1. No-op when client is null — lines 28-30 still execute (covered).
  it("does not pull when client is null", async () => {
    renderHook(() =>
      useVisibilityPull(null, FAKE_USER, NON_BLOCKED_PATH),
    );

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS + 1);
    act(() => fireVisible());

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  // 2. No-op when userId is null — lines 28-30 still execute (covered).
  it("does not pull when userId is null", async () => {
    renderHook(() =>
      useVisibilityPull(FAKE_CLIENT, null, NON_BLOCKED_PATH),
    );

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS + 1);
    act(() => fireVisible());

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  // 3. No-op on blocked route ("/").
  it("does not pull when the current route is blocked", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");

    renderHook(() =>
      useVisibilityPull(FAKE_CLIENT, FAKE_USER, "/"),
    );

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS + 1);
    act(() => fireVisible());

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  // 4. No-op when the tab was hidden for less than the threshold.
  it("does not pull when the hidden gap is below the threshold", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");

    renderHook(() =>
      useVisibilityPull(FAKE_CLIENT, FAKE_USER, NON_BLOCKED_PATH),
    );

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS - 1);
    act(() => fireVisible());

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  // 5. Triggers pullAndMerge when authenticated, non-blocked route, and gap >= threshold.
  it("calls pullAndMerge when tab becomes visible after >= 30 s hidden", () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");

    renderHook(() =>
      useVisibilityPull(FAKE_CLIENT, FAKE_USER, NON_BLOCKED_PATH),
    );

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS + 1);
    act(() => fireVisible());

    expect(pullAndMerge).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER);
  });

  // 6. No-op when visible fires without a prior hidden event (hiddenAt is null).
  it("does not pull when the tab was never hidden first", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");

    renderHook(() =>
      useVisibilityPull(FAKE_CLIENT, FAKE_USER, NON_BLOCKED_PATH),
    );

    // Fire visible without a preceding hidden transition.
    act(() => fireVisible());

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });

  // 7. Uses the latest refs — a re-render with updated props is reflected in
  //    the handler even though the listener was registered only once.
  it("reflects updated client/userId/pathname after re-render (useLatestRef behaviour)", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");

    // Start with null client; the handler should read the latest value.
    const { rerender } = renderHook(
      ({ cl, uid, path }: { cl: SupabaseClient | null; uid: string | null; path: string }) =>
        useVisibilityPull(cl, uid, path),
      {
        initialProps: {
          cl: null as SupabaseClient | null,
          uid: null as string | null,
          path: NON_BLOCKED_PATH,
        },
      },
    );

    // Update to real credentials before the visibility event fires.
    rerender({ cl: FAKE_CLIENT, uid: FAKE_USER, path: NON_BLOCKED_PATH });

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS + 1);
    act(() => fireVisible());

    expect(pullAndMerge).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER);
  });

  // 8. Listener is removed on unmount — no calls after cleanup.
  it("removes the visibilitychange listener on unmount", async () => {
    vi.mocked(pullAndMerge).mockResolvedValue("ok");

    const { unmount } = renderHook(() =>
      useVisibilityPull(FAKE_CLIENT, FAKE_USER, NON_BLOCKED_PATH),
    );

    unmount();

    act(() => fireHidden());
    vi.advanceTimersByTime(HIDDEN_THRESHOLD_MS + 1);
    act(() => fireVisible());

    await Promise.resolve();
    expect(pullAndMerge).not.toHaveBeenCalled();
  });
});
