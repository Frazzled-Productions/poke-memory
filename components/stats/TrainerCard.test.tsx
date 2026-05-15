import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainerCard, trainerLevel, nextLevelMastered, BASE_SPECIES_COUNT } from "./TrainerCard";
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
    for (let m = 2; m < BASE_SPECIES_COUNT; m += 50) {
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
    // BASE_SPECIES_COUNT (1025) -> 51
    expect(trainerLevel(BASE_SPECIES_COUNT)).toBe(51);
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
    for (let m = 0; m <= BASE_SPECIES_COUNT; m++) {
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

  it("shows 'All mastered' when totalMastered reaches the base species cap", () => {
    render(
      <TrainerCard handle={null} totalMastered={BASE_SPECIES_COUNT} perGeneration={ALL_INCOMPLETE} />,
    );
    expect(screen.getByText("All mastered")).toBeInTheDocument();
  });

  it("renders no forms line when totalFormCards is omitted or zero", () => {
    render(
      <TrainerCard handle={null} totalMastered={0} perGeneration={ALL_INCOMPLETE} />,
    );
    expect(screen.queryByText(/forms mastered/)).toBeNull();
  });

  it("renders the secondary forms line when totalFormCards > 0", () => {
    render(
      <TrainerCard
        handle={null}
        totalMastered={10}
        perGeneration={ALL_INCOMPLETE}
        formsMastered={3}
        totalFormCards={50}
      />,
    );
    expect(screen.getByText("3 / 50 forms mastered")).toBeInTheDocument();
  });

  it("renders 0 forms mastered when formsMastered is omitted but totalFormCards is set", () => {
    render(
      <TrainerCard
        handle={null}
        totalMastered={10}
        perGeneration={ALL_INCOMPLETE}
        totalFormCards={50}
      />,
    );
    expect(screen.getByText("0 / 50 forms mastered")).toBeInTheDocument();
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

  it("renders no badge rail when earnedBadges is omitted or empty", () => {
    const { container } = render(
      <TrainerCard handle={null} totalMastered={0} perGeneration={ALL_INCOMPLETE} />,
    );
    expect(container.querySelector('[aria-label="Gym badges earned"]')).toBeNull();
  });

  it("does not hint at unearned badges in any UI text (secret until earned)", () => {
    render(
      <TrainerCard
        handle={null}
        totalMastered={0}
        perGeneration={ALL_INCOMPLETE}
        earnedBadges={[]}
      />,
    );
    // None of the launch badge names should appear anywhere on the trainer
    // card while the earned list is empty.
    for (const name of [
      "Cascade Badge",
      "Boulder Badge",
      "Eeveelutions",
      "Legendary Birds",
    ]) {
      expect(screen.queryByText(name)).toBeNull();
    }
  });

  it("renders an earned-badge chip for each entry", () => {
    render(
      <TrainerCard
        handle={null}
        totalMastered={9}
        perGeneration={ALL_INCOMPLETE}
        earnedBadges={[
          {
            id: "eeveelutions",
            name: "Eeveelutions",
            description: "Eevee + all eight evolutions.",
            lockedHint: "One adaptable Pokémon…",
            criterion: { kind: "all-mastered", speciesIds: [133] },
          },
          {
            id: "cascade-badge",
            name: "Cascade Badge",
            description: "x",
            lockedHint: "A Cerulean gym leader favours the sea…",
            criterion: { kind: "all-mastered", speciesIds: [120, 121] },
          },
        ]}
      />,
    );
    expect(screen.getByText("Eeveelutions")).toBeInTheDocument();
    expect(screen.getByText("Cascade Badge")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Gym badges earned" }),
    ).toBeInTheDocument();
  });
});
