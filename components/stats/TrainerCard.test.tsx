import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainerCard, trainerLevel, nextLevelMastered } from "./TrainerCard";
import type { GenerationStats } from "@/lib/stats/derive";

function gen(g: number, mastered: number, total: number): GenerationStats {
  return { gen: g, name: `Generation ${g}`, total, introduced: mastered, mastered };
}

const ALL_INCOMPLETE: GenerationStats[] = Array.from({ length: 9 }, (_, i) =>
  gen(i + 1, 0, 100),
);

describe("trainerLevel", () => {
  it("floors at 1 for zero mastered", () => {
    expect(trainerLevel(0)).toBe(1);
    expect(trainerLevel(-1)).toBe(1);
  });

  it("monotonic in mastered count", () => {
    let last = trainerLevel(1);
    for (let m = 2; m < 1025; m += 50) {
      const lvl = trainerLevel(m);
      expect(lvl).toBeGreaterThanOrEqual(last);
      last = lvl;
    }
  });

  it("matches the documented anchor points", () => {
    // 10 mastered -> level 5 (floor(sqrt(10) * 1.6))
    expect(trainerLevel(10)).toBe(5);
    // 100 -> 16
    expect(trainerLevel(100)).toBe(16);
    // 1025 -> 51
    expect(trainerLevel(1025)).toBe(51);
  });
});

describe("nextLevelMastered", () => {
  it("returns the count needed to exceed the current level", () => {
    // At level 1 (0 mastered), need 2 to reach Lv 2
    expect(nextLevelMastered(1)).toBe(2);
    // At level 5 (10 mastered), need 15 to reach Lv 6
    expect(nextLevelMastered(5)).toBe(15);
    // At level 16 (100 mastered), need 113 to reach Lv 17
    expect(nextLevelMastered(16)).toBe(113);
  });

  it("always returns more than the mastered count for the same level (full species range)", () => {
    for (let m = 0; m <= 1025; m++) {
      expect(nextLevelMastered(trainerLevel(m))).toBeGreaterThan(m);
    }
  });
});

describe("TrainerCard", () => {
  it("falls back to 'Trainer' when handle is null", () => {
    render(
      <TrainerCard handle={null} totalMastered={0} perGeneration={ALL_INCOMPLETE} />,
    );
    // Both the label and the fallback handle read "Trainer"; assert at least
    // two matches so the fallback is visibly present.
    expect(screen.getAllByText("Trainer").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the user handle when provided", () => {
    render(
      <TrainerCard handle="ash" totalMastered={50} perGeneration={ALL_INCOMPLETE} />,
    );
    expect(screen.getByText("ash")).toBeInTheDocument();
  });

  it("lights a generation badge when that gen is fully mastered", () => {
    const perGen: GenerationStats[] = ALL_INCOMPLETE.map((g, idx) =>
      idx === 0 ? gen(1, 100, 100) : g,
    );
    render(<TrainerCard handle={null} totalMastered={100} perGeneration={perGen} />);
    const gen1Badge = screen.getByTitle(/Generation 1: complete!/);
    expect(gen1Badge.className).toContain("bg-amber-300");
  });

  it("renders a progress line with correct numbers for 0 mastered", () => {
    render(
      <TrainerCard handle={null} totalMastered={0} perGeneration={ALL_INCOMPLETE} />,
    );
    // At Lv 1, nextLevelMastered(1) = 2, needed = 2
    expect(screen.getByText("0 / 2 mastered · 2 to Lv 2")).toBeInTheDocument();
  });

  it("renders a progress line with correct numbers for a higher mastered count", () => {
    render(
      <TrainerCard handle={null} totalMastered={10} perGeneration={ALL_INCOMPLETE} />,
    );
    // At Lv 5, nextLevelMastered(5) = 15, needed = 5
    expect(screen.getByText("10 / 15 mastered · 5 to Lv 6")).toBeInTheDocument();
  });

  it("shows 'All mastered' when totalMastered reaches the species cap", () => {
    render(
      <TrainerCard handle={null} totalMastered={1025} perGeneration={ALL_INCOMPLETE} />,
    );
    expect(screen.getByText("All mastered")).toBeInTheDocument();
  });

  it("level number is described by the mastery criterion text", () => {
    render(
      <TrainerCard handle={null} totalMastered={0} perGeneration={ALL_INCOMPLETE} />,
    );
    // sr-only element carries the accessible description
    const descEl = screen.getByText(/reps.*3.*interval.*21/i);
    expect(descEl).toHaveAttribute("id", "trainer-level-desc");
    // level span wires up to it
    const levelSpan = screen.getByText("1", { selector: '[aria-describedby="trainer-level-desc"]' });
    expect(levelSpan).toBeInTheDocument();
  });
});
