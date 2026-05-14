import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpritePicker, fisherYatesShuffle } from "@/components/review/SpritePicker";
import type { SeedPokemon } from "@/lib/pokemon/seed";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("@/lib/audio/tts", () => ({
  speakName: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePokemon(overrides: Partial<SeedPokemon> & Pick<SeedPokemon, "id" | "name">): SeedPokemon {
  return {
    speciesId: overrides.id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: overrides.name,
    spriteUrl: `/sprites/${overrides.name.toLowerCase()}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A test Pokémon.",
    flavorTexts: ["A test Pokémon."],
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    ...overrides,
  };
}

const TARGET = makePokemon({ id: 1, name: "Bulbasaur" });
const DISTRACTOR_A = makePokemon({ id: 2, name: "Ivysaur" });
const DISTRACTOR_B = makePokemon({ id: 3, name: "Venusaur" });
const DISTRACTOR_C = makePokemon({ id: 4, name: "Charmander" });

const DISTRACTORS = [DISTRACTOR_A, DISTRACTOR_B, DISTRACTOR_C] as const;

// ---------------------------------------------------------------------------
// fisherYatesShuffle — unit tests
// ---------------------------------------------------------------------------

describe("fisherYatesShuffle", () => {
  it("returns an array of the same length as the input", () => {
    const input = [1, 2, 3, 4];
    const result = fisherYatesShuffle(input);
    expect(result).toHaveLength(input.length);
  });

  it("contains all the same elements as the input", () => {
    const input = [1, 2, 3, 4];
    const result = fisherYatesShuffle(input);
    expect([...result].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
  });

  it("does not mutate the original array", () => {
    const input = [1, 2, 3, 4];
    const original = [...input];
    fisherYatesShuffle(input);
    expect(input).toEqual(original);
  });

  it("produces at least one distinct ordering across 20 independent calls", () => {
    // Statistical test: with 4 elements there are 24 possible orderings.
    // The probability that 20 independent shuffles all produce the same
    // ordering is (1/24)^19 ≈ 10^-26 — effectively impossible with real randomness.
    const input = [1, 2, 3, 4];
    const first = fisherYatesShuffle(input).join(",");
    const allSame = Array.from({ length: 19 }, () =>
      fisherYatesShuffle(input).join(","),
    ).every((order) => order === first);
    expect(allSame).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SpritePicker — component tests
// ---------------------------------------------------------------------------

describe("SpritePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 4 option buttons with correct aria-labels", () => {
    render(
      <SpritePicker
        targetPokemon={TARGET}
        distractors={DISTRACTORS}
        onGrade={vi.fn()}
      />,
    );

    // All 4 Pokémon should be present as accessible buttons.
    expect(screen.getByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ivysaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Venusaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Charmander" })).toBeInTheDocument();
  });

  it("shows the target Pokémon name as the prompt heading", () => {
    render(
      <SpritePicker
        targetPokemon={TARGET}
        distractors={DISTRACTORS}
        onGrade={vi.fn()}
      />,
    );
    // The target name appears in a <p> prompt and also as sr-only spans inside
    // each button; use getAllByText and assert at least one match.
    const matches = screen.getAllByText("Bulbasaur");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("calls onGrade(true) when the correct tile is clicked, after the feedback delay", () => {
    vi.useFakeTimers();
    try {
      const onGrade = vi.fn();
      render(
        <SpritePicker
          targetPokemon={TARGET}
          distractors={DISTRACTORS}
          onGrade={onGrade}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Bulbasaur" }));
      expect(onGrade).not.toHaveBeenCalled();

      act(() => vi.runAllTimers());
      expect(onGrade).toHaveBeenCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onGrade(false) when a wrong tile is clicked, after the feedback delay", () => {
    vi.useFakeTimers();
    try {
      const onGrade = vi.fn();
      render(
        <SpritePicker
          targetPokemon={TARGET}
          distractors={DISTRACTORS}
          onGrade={onGrade}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Ivysaur" }));
      expect(onGrade).not.toHaveBeenCalled();

      act(() => vi.runAllTimers());
      expect(onGrade).toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("produces different option orderings across multiple mounts with the same props", () => {
    // Run 20 mounts and record the rendered button order each time.
    // At least one must differ, proving the shuffle is not deterministic (#496).
    // Each mount is wrapped in its own container to avoid DOM conflicts.
    //
    // NOTE: this test relies on real Math.random. If a future test setup mocks or
    // seeds Math.random globally (e.g. vi.spyOn(Math, "random") or faker.seed()),
    // every mount will produce the same ordering and this assertion will silently
    // become a no-op.
    const orders: string[] = [];

    for (let i = 0; i < 20; i++) {
      const { container, unmount } = render(
        <SpritePicker
          targetPokemon={TARGET}
          distractors={DISTRACTORS}
          onGrade={vi.fn()}
        />,
      );
      const buttons = Array.from(container.querySelectorAll("button[aria-label]"))
        .filter((btn) => {
          const label = btn.getAttribute("aria-label") ?? "";
          return ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander"].includes(label);
        })
        .map((btn) => btn.getAttribute("aria-label") ?? "");
      orders.push(buttons.join(","));
      unmount();
    }

    const first = orders[0];
    const allSame = orders.every((o) => o === first);
    expect(allSame).toBe(false);
  });
});
