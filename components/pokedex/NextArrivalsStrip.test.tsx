/**
 * Component tests for NextArrivalsStrip (#1316).
 *
 * Covers:
 *   - Returns null (renders nothing) when forceAllMastered is true
 *   - Returns null when there are no reviewed-but-unmastered cards
 *   - Renders up to STRIP_LIMIT (5) species when qualifying cards exist
 *   - Displays sprite and name for each entry
 *   - Species are ordered closest-first (highest score first)
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import type { ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

// ---------------------------------------------------------------------------
// Mock next/image
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    width,
    height,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} alt={alt} width={width} height={height} />
  ),
}));

// ---------------------------------------------------------------------------
// Mock useLocalePokemonName — returns the English name as-is.
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_id: number, englishName: string) => ({
    name: englishName,
    transliteration: null,
  }),
}));

// ---------------------------------------------------------------------------
// Import the component under test after mocks.
// ---------------------------------------------------------------------------

import { NextArrivalsStrip } from "@/components/pasture/NextArrivalsStrip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: "2099-01-01",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

function makeCard(id: number, state: Partial<ReviewState> = {}): ReviewableCard {
  return {
    id,
    speciesId: id,
    cardType: "name",
    subjectKey: String(id),
    locale: "en",
    name: `Pokemon-${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    displayName: `Pokemon-${id}`,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: null,
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: makeState(state),
  } as ReviewableCard;
}

const MASTERY_REPS = 3;
const MASTERY_DAYS = 21;

// ---------------------------------------------------------------------------
// Tests — hidden when empty
// ---------------------------------------------------------------------------

describe("NextArrivalsStrip — hidden when empty", () => {
  it("renders nothing when forceAllMastered is true", () => {
    const { container } = render(
      <NextArrivalsStrip
        cards={[makeCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" })]}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={true}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there are no reviewed cards", () => {
    const { container } = render(
      <NextArrivalsStrip
        cards={[makeCard(1)]} // lastReview === null → never reviewed
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when all reviewed cards are mastered", () => {
    const masteredState: Partial<ReviewState> = {
      reps: MASTERY_REPS,
      scheduledDays: MASTERY_DAYS,
      lastReview: "2024-01-01",
    };
    const nameCardMastered = makeCard(1, masteredState);
    const reverseCardMastered = {
      ...nameCardMastered,
      id: REVERSE_ID_OFFSET + 1,
      cardType: "reverse",
    } as unknown as ReviewableCard;
    const cards: ReviewableCard[] = [nameCardMastered, reverseCardMastered];
    const { container } = render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the cards array is empty", () => {
    const { container } = render(
      <NextArrivalsStrip
        cards={[]}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — renders strip with qualifying cards
// ---------------------------------------------------------------------------

describe("NextArrivalsStrip — renders strip", () => {
  it("renders the section heading", () => {
    const cards: ReviewableCard[] = [
      makeCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
    ];
    render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(screen.getByRole("region", { name: /next arrivals/i })).toBeInTheDocument();
  });

  it("renders a sprite for each qualifying entry", () => {
    const cards: ReviewableCard[] = [
      makeCard(1, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
      makeCard(2, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
    ];
    render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(screen.getByAltText("Pokemon-1")).toBeInTheDocument();
    expect(screen.getByAltText("Pokemon-2")).toBeInTheDocument();
  });

  it("renders the name for each entry", () => {
    const cards: ReviewableCard[] = [
      makeCard(42, { reps: 2, scheduledDays: 10, lastReview: "2024-01-01" }),
    ];
    render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(screen.getByText("Pokemon-42")).toBeInTheDocument();
  });

  it("caps at 5 entries even when more qualifying cards exist", () => {
    const cards: ReviewableCard[] = Array.from({ length: 10 }, (_, i) =>
      makeCard(i + 1, { reps: i + 1, scheduledDays: 1, lastReview: "2024-01-01" }),
    );
    render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  it("orders entries with the highest score first", () => {
    const cards: ReviewableCard[] = [
      makeCard(1, { reps: 1, scheduledDays: 0, lastReview: "2024-01-01" }), // score=1000
      makeCard(2, { reps: 2, scheduledDays: 5, lastReview: "2024-01-01" }), // score=2005
      makeCard(3, { reps: 0, scheduledDays: 0, lastReview: "2024-01-01" }), // score=0
    ];
    render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    const items = screen.getAllByRole("listitem");
    // Expected order: id2 (score 2005), id1 (score 1000), id3 (score 0)
    expect(items[0]).toHaveTextContent("Pokemon-2");
    expect(items[1]).toHaveTextContent("Pokemon-1");
    expect(items[2]).toHaveTextContent("Pokemon-3");
  });

  it("has an accessible list label", () => {
    const cards: ReviewableCard[] = [
      makeCard(1, { reps: 1, scheduledDays: 5, lastReview: "2024-01-01" }),
    ];
    render(
      <NextArrivalsStrip
        cards={cards}
        masteryRepetitions={MASTERY_REPS}
        forceAllMastered={false}
      />,
    );
    expect(screen.getByRole("list", { name: /closest to mastery/i })).toBeInTheDocument();
  });
});
