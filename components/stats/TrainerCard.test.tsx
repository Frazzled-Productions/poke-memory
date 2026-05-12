import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainerCard, trainerLevel } from "./TrainerCard";
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
});
