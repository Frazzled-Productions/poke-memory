import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

function makeReviewState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-19",
    lastReview: "2026-05-18",
    firstSeen: "2026-05-18",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: true,
    ...overrides,
  };
}

function makeCard(overrides: Partial<NameReviewCard> = {}): NameReviewCard {
  return {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
    name: "Bulbasaur",
    spriteUrl: "/sprites/pokemon/1.png",
    types: ["grass", "poison"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
    flavorText: "A strange seed was planted on its back at birth.",
    flavorTexts: [],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 4,
    isLegendary: false,
    isMythical: false,
    cryUrl: "/cries/1.ogg",
    cardType: "name",
    subjectKey: "1",
    state: makeReviewState(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import component under test after mocks
// ---------------------------------------------------------------------------

import { PasturePokemon } from "@/components/pasture/PasturePokemon";
import { PASTURE_SPRITE_SIZE } from "@/lib/sprites/sizes";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PasturePokemon — sprite rendering", () => {
  it("renders a sprite image with the card name as alt text", () => {
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />);
    const img = screen.getByAltText("Bulbasaur");
    expect(img).toBeInTheDocument();
  });

  it("renders the sprite at the shared PASTURE_SPRITE_SIZE dimensions", () => {
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />);
    const img = screen.getByAltText("Bulbasaur");
    expect(img).toHaveAttribute("width", String(PASTURE_SPRITE_SIZE));
    expect(img).toHaveAttribute("height", String(PASTURE_SPRITE_SIZE));
  });

  it("renders the sprite src from the card's spriteUrl", () => {
    const spriteUrl = "/sprites/pokemon/25.png";
    const card = makeCard({ spriteUrl });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    const img = screen.getByAltText("Bulbasaur");
    expect(img).toHaveAttribute("src", spriteUrl);
  });
});

describe("PasturePokemon — arrival sparkle", () => {
  it("shows an arrival sparkle when seenInPasture is false", () => {
    const card = makeCard({ state: makeReviewState({ seenInPasture: false }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    // ArrivalSparkle renders as aria-hidden; the button label includes "(new arrival)"
    const btn = screen.getByRole("button", {
      name: /Bulbasaur.*new arrival/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("does not add (new arrival) to the aria-label when seenInPasture is true", () => {
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Bulbasaur" });
    expect(btn).toBeInTheDocument();
  });
});
