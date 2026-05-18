import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MilestoneShareButton } from "./MilestoneShareButton";
import type { Milestone } from "@/lib/journey/milestones";

// ---------------------------------------------------------------------------
// Fixtures — use the flat Milestone shape produced by detectTopMilestone.
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

describe("MilestoneShareButton — null prop", () => {
  it("renders nothing when milestone is null", () => {
    const { container } = render(<MilestoneShareButton milestone={null} />);
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("MilestoneShareButton — rendering", () => {
  it("shows the mastery-count label for a count milestone", () => {
    render(<MilestoneShareButton milestone={countMilestone} />);
    expect(screen.getByText("100 Pokémon mastered")).toBeInTheDocument();
  });

  it("shows the gen-complete label for a generation milestone", () => {
    render(<MilestoneShareButton milestone={genMilestone} />);
    expect(screen.getByText("Generation I complete!")).toBeInTheDocument();
  });

  it("shows the 'all mastered' label", () => {
    render(<MilestoneShareButton milestone={allMasteredMilestone} />);
    expect(screen.getByText("You've mastered all Pokémon!")).toBeInTheDocument();
  });

  it("renders a Share button with an accessible label", () => {
    render(<MilestoneShareButton milestone={countMilestone} />);
    const btn = screen.getByRole("button", { name: /Share milestone: 100 Pokémon mastered/i });
    expect(btn).toBeInTheDocument();
  });

  it("renders the milestone banner data-testid", () => {
    render(<MilestoneShareButton milestone={countMilestone} />);
    expect(screen.getByTestId("milestone-share-banner")).toBeInTheDocument();
  });

  it("does not render a status message initially", () => {
    render(<MilestoneShareButton milestone={countMilestone} />);
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

describe("MilestoneShareButton — clipboard fallback", () => {
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
      // ignore — may not be configurable on some jsdom versions
    }
  });

  it("shows 'Copied to clipboard' after a successful clipboard write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<MilestoneShareButton milestone={countMilestone} />);
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

    render(<MilestoneShareButton milestone={countMilestone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Share milestone/i }));
    });

    expect(screen.getByText(/Couldn't copy/i)).toBeInTheDocument();
  });
});
