import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MilestoneCelebration } from "./MilestoneCelebration";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Copy and ARIA
// ---------------------------------------------------------------------------

describe("MilestoneCelebration — copy", () => {
  it("shows the milestone number in the headline for light milestones", () => {
    render(<MilestoneCelebration milestone={3} onDismiss={() => {}} />);
    expect(screen.getByText("3-day streak!")).toBeInTheDocument();
    expect(screen.getByText("Keep it up!")).toBeInTheDocument();
  });

  it("shows a distinct sub-copy for standard milestones", () => {
    render(<MilestoneCelebration milestone={100} onDismiss={() => {}} />);
    expect(screen.getByText("100-day streak!")).toBeInTheDocument();
    expect(screen.getByText("You are on a roll.")).toBeInTheDocument();
  });

  it("shows a custom headline for the 365-day milestone", () => {
    render(<MilestoneCelebration milestone={365} onDismiss={() => {}} />);
    expect(screen.getByText("One year.")).toBeInTheDocument();
    expect(screen.getByText("One full year of practice.")).toBeInTheDocument();
  });

  it("shows a numeric headline for post-365 milestones", () => {
    render(<MilestoneCelebration milestone={465} onDismiss={() => {}} />);
    expect(screen.getByText("465-day streak!")).toBeInTheDocument();
    expect(screen.getByText("Over a year and counting.")).toBeInTheDocument();
  });

  it("falls back to the major-tier sub-copy for a major milestone with no keyed copy", () => {
    // 665 is major-tier but has no entry in MILESTONE_SUB — exercises the fallback.
    render(<MilestoneCelebration milestone={665} onDismiss={() => {}} />);
    expect(screen.getByText("665-day streak!")).toBeInTheDocument();
    expect(screen.getByText("That is seriously impressive.")).toBeInTheDocument();
  });

  it("has the correct accessible aria-label", () => {
    render(<MilestoneCelebration milestone={30} onDismiss={() => {}} />);
    expect(
      screen.getByRole("status", { name: "30-day streak reached" }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tier-specific rendering
// ---------------------------------------------------------------------------

describe("MilestoneCelebration — tiers", () => {
  it("applies the light tier class for milestone 3", () => {
    const { container } = render(
      <MilestoneCelebration milestone={3} onDismiss={() => {}} />,
    );
    // The overlay root carries the tier modifier class.
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toMatch(/overlay--light/);
    // The banner also carries its tier class.
    const banner = container.querySelector("[class*='banner']") as HTMLElement;
    expect(banner.className).toMatch(/banner--light/);
  });

  it("applies the standard tier class for milestone 60", () => {
    const { container } = render(
      <MilestoneCelebration milestone={60} onDismiss={() => {}} />,
    );
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toMatch(/overlay--standard/);
    const banner = container.querySelector("[class*='banner']") as HTMLElement;
    expect(banner.className).toMatch(/banner--standard/);
  });

  it("applies the major tier class for milestone 365", () => {
    const { container } = render(
      <MilestoneCelebration milestone={365} onDismiss={() => {}} />,
    );
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toMatch(/overlay--major/);
    const banner = container.querySelector("[class*='banner']") as HTMLElement;
    expect(banner.className).toMatch(/banner--major/);
  });

  it("renders more confetti pieces for major milestones than light ones", () => {
    const { container: lightContainer } = render(
      <MilestoneCelebration milestone={7} onDismiss={() => {}} />,
    );
    const { container: majorContainer } = render(
      <MilestoneCelebration milestone={365} onDismiss={() => {}} />,
    );
    const lightPieces = lightContainer.querySelectorAll("[class*='confetti']");
    const majorPieces = majorContainer.querySelectorAll("[class*='confetti']");
    expect(majorPieces.length).toBeGreaterThan(lightPieces.length);
  });
});

// ---------------------------------------------------------------------------
// Auto-dismiss
// ---------------------------------------------------------------------------

describe("MilestoneCelebration — timing", () => {
  it("auto-dismisses after 4500 ms", () => {
    const onDismiss = vi.fn();
    render(<MilestoneCelebration milestone={30} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss before 4500 ms have elapsed", () => {
    const onDismiss = vi.fn();
    render(<MilestoneCelebration milestone={30} onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
