import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ShareTodayButton } from "./ShareTodayButton";
import type { DailySummaryParts } from "@/lib/review/share";

// Mock the image generator — canvas is not available in jsdom and the
// rendering logic is covered separately in components/share/generateShareImage.test.tsx.
vi.mock("@/lib/share/generateShareImage", () => ({
  generateDailyShareImage: vi.fn().mockResolvedValue(null),
}));

import { generateDailyShareImage } from "@/lib/share/generateShareImage";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARTS: DailySummaryParts = {
  date: "2026-05-12",
  streak: 7,
  reviewed: 24,
  newCards: 6,
  mastered: 2,
  gradeSequence: [4, 5, 4, 1, 4],
};

const TEXT = "poke-memory · 2026-05-12\n7-day streak 🔥\n24 reviewed · 6 new · 2 mastered\n🟩🟦🟩⬛🟩";

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("ShareTodayButton — rendering", () => {
  it("renders a 'Share today' button", () => {
    render(<ShareTodayButton parts={PARTS} text={TEXT} />);
    expect(
      screen.getByRole("button", { name: /share today/i }),
    ).toBeInTheDocument();
  });

  it("does not show a status message initially", () => {
    render(<ShareTodayButton parts={PARTS} text={TEXT} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Clipboard fallback
//
// jsdom does not implement navigator.share, navigator.canShare, or
// navigator.clipboard by default — the component falls through to the
// clipboard path. We use fake timers + fireEvent.click to maintain control.
// ---------------------------------------------------------------------------

describe("ShareTodayButton — clipboard fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
    } catch {
      // ignore — may not be configurable on some jsdom versions
    }
  });

  it("shows 'Copied to clipboard' after a successful clipboard write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<ShareTodayButton parts={PARTS} text={TEXT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share today/i }));
    });

    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();

    // Confirmation resets after 2 s.
    await act(async () => {
      vi.advanceTimersByTime(2001);
    });
    expect(screen.queryByText("Copied to clipboard")).toBeNull();
  });

  it("shows an error message when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(<ShareTodayButton parts={PARTS} text={TEXT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share today/i }));
    });

    expect(screen.getByText(/Couldn't copy/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Web Share API file path
// ---------------------------------------------------------------------------

describe("ShareTodayButton — Web Share API file path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Remove navigator properties set via Object.defineProperty.
    for (const prop of ["canShare", "share"] as const) {
      try {
        Object.defineProperty(navigator, prop, {
          value: undefined,
          configurable: true,
          writable: true,
        });
      } catch {
        // ignore — may not be configurable on all jsdom versions
      }
    }
  });

  it("calls navigator.share with a File when canShare({ files }) returns true", async () => {
    // Override the mock to return a real Blob so the File can be constructed.
    const mockBlob = new Blob(["png"], { type: "image/png" });
    vi.mocked(generateDailyShareImage).mockResolvedValueOnce(mockBlob);

    const shareFn = vi.fn().mockResolvedValue(undefined);
    const canShareFn = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "canShare", {
      value: canShareFn,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: shareFn,
      configurable: true,
      writable: true,
    });

    render(<ShareTodayButton parts={PARTS} text={TEXT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share today/i }));
    });

    expect(shareFn).toHaveBeenCalledOnce();
    const arg = shareFn.mock.calls[0][0] as { files?: File[] };
    expect(Array.isArray(arg.files)).toBe(true);
    expect(arg.files![0]).toBeInstanceOf(File);
    expect(arg.files![0].name).toBe("poke-memory.png");
    // No status message because share succeeded.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to text share when canShare({ files }) returns false", async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined);
    const canShareFn = vi.fn().mockReturnValue(false);
    Object.defineProperty(navigator, "canShare", {
      value: canShareFn,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: shareFn,
      configurable: true,
      writable: true,
    });

    render(<ShareTodayButton parts={PARTS} text={TEXT} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share today/i }));
    });

    // share called with text, not files
    expect(shareFn).toHaveBeenCalledOnce();
    const arg = shareFn.mock.calls[0][0] as { text?: string; files?: File[] };
    expect(arg.text).toBe(TEXT);
    expect(arg.files).toBeUndefined();
  });
});
