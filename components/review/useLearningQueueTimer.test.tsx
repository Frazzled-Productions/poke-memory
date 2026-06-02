import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLearningQueueTimer } from "@/components/review/useLearningQueueTimer";

afterEach(() => {
  vi.useRealTimers();
});

describe("useLearningQueueTimer — empty queue", () => {
  it("does not call onDue when learningQueue is empty", () => {
    vi.useFakeTimers();
    const onDue = vi.fn();
    renderHook(() => useLearningQueueTimer([], onDue));
    vi.runAllTimers();
    expect(onDue).not.toHaveBeenCalled();
  });
});

describe("useLearningQueueTimer — all entries already due", () => {
  it("does not schedule a timeout when all entries are in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const onDue = vi.fn();
    const past = Date.now() - 1000;
    renderHook(() =>
      useLearningQueueTimer([{ cardId: 1, dueAt: past }], onDue),
    );
    vi.runAllTimers();
    expect(onDue).not.toHaveBeenCalled();
  });
});

describe("useLearningQueueTimer — future entry", () => {
  it("calls onDue after the delay when a future entry exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const onDue = vi.fn();
    const future = Date.now() + 500;

    renderHook(() =>
      useLearningQueueTimer([{ cardId: 1, dueAt: future }], onDue),
    );

    expect(onDue).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(onDue).toHaveBeenCalledOnce();
  });

  it("fires for the earliest entry when multiple future entries exist", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const onDue = vi.fn();
    const now = Date.now();

    renderHook(() =>
      useLearningQueueTimer(
        [
          { cardId: 1, dueAt: now + 2000 },
          { cardId: 2, dueAt: now + 500 },
        ],
        onDue,
      ),
    );

    await act(async () => { vi.advanceTimersByTime(600); });
    expect(onDue).toHaveBeenCalledOnce();

    // Only fired once — the second entry has not yet elapsed.
    onDue.mockClear();
    await act(async () => { vi.advanceTimersByTime(1500); });
    // The effect re-runs with a fresh queue on each render cycle; since
    // the hook was not re-rendered with an updated queue, no second fire.
    expect(onDue).not.toHaveBeenCalled();
  });

  it("cleans up the timeout on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const onDue = vi.fn();
    const future = Date.now() + 500;

    const { unmount } = renderHook(() =>
      useLearningQueueTimer([{ cardId: 1, dueAt: future }], onDue),
    );

    unmount();
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(onDue).not.toHaveBeenCalled();
  });
});
