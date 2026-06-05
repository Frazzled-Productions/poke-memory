import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
import { MilestoneShareButton } from "./MilestoneShareButton";
import type { Milestone } from "@/lib/journey/milestones";

// Mock the image generator - canvas is not available in jsdom.
vi.mock("@/lib/share/generateShareImage", () => ({
  generateMilestoneShareImage: vi.fn().mockResolvedValue(null),
}));

import { generateMilestoneShareImage } from "@/lib/share/generateShareImage";

// ---------------------------------------------------------------------------
// Fixtures - use the flat Milestone shape produced by detectTopMilestone.
// ---------------------------------------------------------------------------

const countMilestone: Milestone = {
  id: "mastery-100",
  kind: "mastery-count",
  label: "100 Pokémon mastered",
  shareText: "I've mastered 100 Pokémon in Poké Memory! 🌟 https://pokememory.com",
};

const genMilestone: Milestone = {
  id: "gen-1-complete",
  kind: "gen-complete",
  label: "Generation I complete!",
  shareText:
    "I've mastered every Generation I Pokémon in Poké Memory! 🏆 https://pokememory.com",
};

const allMasteredMilestone: Milestone = {
  id: "all-mastered",
  kind: "all-mastered",
  label: "You've mastered all Pokémon!",
  shareText: "I've mastered all 1 025 Pokémon in Poké Memory! 🎉 https://pokememory.com",
};

// ---------------------------------------------------------------------------
// Null guard
// ---------------------------------------------------------------------------

describe("MilestoneShareButton - null prop", () => {
  it("renders nothing when milestone is null", () => {
    const { container } = renderWithIntl(<MilestoneShareButton milestone={null} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("MilestoneShareButton - rendering", () => {
  it("shows the mastery-count label for a count milestone", () => {
    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    expect(screen.getByText("100 Pokémon mastered")).toBeInTheDocument();
  });

  it("shows the gen-complete label for a generation milestone", () => {
    renderWithIntl(<MilestoneShareButton milestone={genMilestone} />);
    expect(screen.getByText("Generation I complete!")).toBeInTheDocument();
  });

  it("shows the 'all mastered' label", () => {
    renderWithIntl(<MilestoneShareButton milestone={allMasteredMilestone} />);
    expect(screen.getByText("You've mastered all Pokémon!")).toBeInTheDocument();
  });

  it("renders a Share button with an accessible label", () => {
    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    const btn = screen.getByRole("button", { name: /Share milestone: 100 Pokémon mastered/i });
    expect(btn).toBeInTheDocument();
  });

  it("renders the milestone banner data-testid", () => {
    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    expect(screen.getByTestId("milestone-share-banner")).toBeInTheDocument();
  });

  it("does not render a status message initially", () => {
    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Clipboard fallback
//
// jsdom does not implement navigator.share or navigator.clipboard by default.
// The component falls through to the clipboard path when share is absent.
// We use fake timers + fireEvent.click (not userEvent) to keep full control.
// ---------------------------------------------------------------------------

describe("MilestoneShareButton - clipboard fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Remove any clipboard property we patched.
    try {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
    } catch {
      // ignore - may not be configurable on some jsdom versions
    }
  });

  it("shows 'Copied to clipboard' after a successful clipboard write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    expect(writeText).toHaveBeenCalledWith(countMilestone.shareText);
    expect(screen.getByText("Copied to clipboard")).toBeInTheDocument();

    // After 2 s the confirmation message resets.
    await act(async () => {
      vi.advanceTimersByTime(2001);
    });
    expect(screen.queryByText("Copied to clipboard")).toBeNull();
  });

  it("shows an error message when navigator.clipboard is unavailable", async () => {
    // jsdom: navigator.clipboard is undefined by default.
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    expect(screen.getByText(/Couldn't copy/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Web Share API file path (Path 1)
// ---------------------------------------------------------------------------

describe("MilestoneShareButton - Web Share API file path", () => {
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
        // ignore - may not be configurable on all jsdom versions
      }
    }
  });

  it("calls navigator.share with a File when canShare({ files }) returns true", async () => {
    const mockBlob = new Blob(["png"], { type: "image/png" });
    vi.mocked(generateMilestoneShareImage).mockResolvedValueOnce(mockBlob);

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

    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    expect(shareFn).toHaveBeenCalledOnce();
    const arg = shareFn.mock.calls[0][0] as { files?: File[] };
    expect(Array.isArray(arg.files)).toBe(true);
    expect(arg.files![0]).toBeInstanceOf(File);
    expect(arg.files![0].name).toBe("poke-memory.png");
    // No status message because share succeeded.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does NOT open a second share sheet when the user dismisses Path 1 (AbortError)", async () => {
    const mockBlob = new Blob(["png"], { type: "image/png" });
    vi.mocked(generateMilestoneShareImage).mockResolvedValueOnce(mockBlob);

    const abortError = new DOMException("Share cancelled", "AbortError");
    const shareFn = vi.fn().mockRejectedValue(abortError);
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

    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    // share was called exactly once (Path 1 only) and no second sheet was opened.
    expect(shareFn).toHaveBeenCalledOnce();
    // No status shown - treated as a user cancellation, not an error.
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

    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    // share called with text, not files.
    expect(shareFn).toHaveBeenCalledOnce();
    const arg = shareFn.mock.calls[0][0] as { text?: string; files?: File[] };
    expect(arg.text).toBe(countMilestone.shareText);
    expect(arg.files).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PNG download fallback (Path 3)
// ---------------------------------------------------------------------------

describe("MilestoneShareButton - PNG download fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers a PNG download when the image rendered but Share API is absent", async () => {
    const mockBlob = new Blob(["png"], { type: "image/png" });
    vi.mocked(generateMilestoneShareImage).mockResolvedValueOnce(mockBlob);

    // No navigator.share or navigator.canShare - fall through to Path 3.
    const mockUrl = "blob:mock-url";
    const createObjectURL = vi.fn().mockReturnValue(mockUrl);
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });

    const anchorClickFn = vi.fn();
    const mockAnchor = {
      href: "",
      download: "",
      click: anchorClickFn,
    } as unknown as HTMLAnchorElement;
    // Save the real createElement before wrapping so the fallback does not
    // recurse infinitely into the spy.
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "a") return mockAnchor;
      return realCreateElement(tag);
    });

    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    expect(createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(mockAnchor.download).toBe("poke-memory.png");
    expect(anchorClickFn).toHaveBeenCalledOnce();
    // No status message on a successful download.
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Locale coverage (mandatory per AGENTS.md - #1393)
// ---------------------------------------------------------------------------

describe("MilestoneShareButton - Japanese locale (#1393)", () => {
  it("renders the Japanese Share button label in ja locale", () => {
    renderJa(<MilestoneShareButton milestone={countMilestone} />);
    // ja journey.milestoneShare.share = "シェア"
    expect(screen.getByRole("button", { name: /シェア/ })).toBeInTheDocument();
  });

  it("renders the Japanese aria-label on the Share button in ja locale", () => {
    renderJa(<MilestoneShareButton milestone={countMilestone} />);
    // ja journey.milestoneShare.shareAriaLabel = "マイルストーンをシェア: {label}"
    expect(
      screen.getByRole("button", { name: /マイルストーンをシェア/ }),
    ).toBeInTheDocument();
  });
});
