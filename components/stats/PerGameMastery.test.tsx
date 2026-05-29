/**
 * Component tests for PerGameMastery (issue #1313).
 * Runs in the `jsdom` vitest project.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PerGameMastery } from "@/components/stats/PerGameMastery";
import type { GameStats } from "@/lib/stats/perGame";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const redBlue: GameStats = {
  slug: "red-blue",
  label: "Pokémon Red/Blue",
  generation: 1,
  total: 151,
  mastered: 76,
};

const goldSilver: GameStats = {
  slug: "gold-silver",
  label: "Pokémon Gold/Silver",
  generation: 2,
  total: 251,
  mastered: 0,
};

const complete: GameStats = {
  slug: "yellow",
  label: "Pokémon Yellow",
  generation: 1,
  total: 151,
  mastered: 151,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PerGameMastery — empty array", () => {
  it("renders nothing when games array is empty", () => {
    const { container } = render(<PerGameMastery games={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("PerGameMastery — rendering", () => {
  it("renders the section heading", () => {
    render(<PerGameMastery games={[redBlue]} />);
    expect(screen.getByRole("heading", { name: "By game" })).toBeInTheDocument();
  });

  it("renders the game label", () => {
    render(<PerGameMastery games={[redBlue]} />);
    expect(screen.getByText("Pokémon Red/Blue")).toBeInTheDocument();
  });

  it("renders mastered/total fraction", () => {
    render(<PerGameMastery games={[redBlue]} />);
    expect(screen.getByText("76/151")).toBeInTheDocument();
  });

  it("renders a progressbar with correct aria values", () => {
    render(<PerGameMastery games={[redBlue]} />);
    const bar = screen.getByRole("progressbar", { name: /Pokémon Red\/Blue mastered/i });
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "50"); // 76/151 ≈ 50%
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("renders the generation group label", () => {
    render(<PerGameMastery games={[redBlue]} />);
    expect(screen.getByText("Generation I")).toBeInTheDocument();
  });

  it("renders multiple games grouped by generation", () => {
    render(<PerGameMastery games={[redBlue, goldSilver]} />);
    expect(screen.getByText("Generation I")).toBeInTheDocument();
    expect(screen.getByText("Generation II")).toBeInTheDocument();
    expect(screen.getByText("Pokémon Red/Blue")).toBeInTheDocument();
    expect(screen.getByText("Pokémon Gold/Silver")).toBeInTheDocument();
  });

  it("shows 0/total when nothing is mastered", () => {
    render(<PerGameMastery games={[goldSilver]} />);
    expect(screen.getByText("0/251")).toBeInTheDocument();
  });
});

describe("PerGameMastery — complete game", () => {
  it("renders a complete game with correct mastered count", () => {
    render(<PerGameMastery games={[complete]} />);
    expect(screen.getByText("151/151")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /Pokémon Yellow mastered/i });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("PerGameMastery — generation ordering", () => {
  it("places Generation I before Generation II in the DOM", () => {
    render(<PerGameMastery games={[goldSilver, redBlue]} />);
    const headings = screen.getAllByText(/Generation (I|II)/);
    expect(headings[0].textContent).toBe("Generation I");
    expect(headings[1].textContent).toBe("Generation II");
  });
});

describe("PerGameMastery — accessibility", () => {
  it("progressbar aria-label contains the game name", () => {
    render(<PerGameMastery games={[redBlue]} />);
    expect(screen.getByRole("progressbar", { name: /Pokémon Red\/Blue/i })).toBeInTheDocument();
  });

  it("fraction span has aria-label with mastered/total wording", () => {
    render(<PerGameMastery games={[redBlue]} />);
    // The aria-label is on the span that shows "76/151"
    expect(screen.getByLabelText("76 of 151 mastered")).toBeInTheDocument();
  });
});
