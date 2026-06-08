/**
 * Component tests for PastureZone.
 *
 * Primary goal: cover line 186 (the `<PasturePokemon>` render inside the
 * placements `.map`) so the diff-coverage gate passes for the #1786 change
 * (removal of the `legStatusMap` prop from PasturePokemon).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl, screen } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// Mock next/link so it renders a plain <a> in jsdom.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// useLocalePokemonName: controlled per-test.
const mockUseLocalePokemonName = vi.fn();
vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (...args: Parameters<typeof mockUseLocalePokemonName>) =>
    mockUseLocalePokemonName(...args),
}));

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({
    locale: "en",
    languagesEnabled: false,
    learningLocales: ["en"],
  }),
  PokemonLocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// useIdleBehaviour calls requestAnimationFrame, IntersectionObserver, etc.
// Mock it to a no-op so jsdom's lack of real layout APIs doesn't interfere.
vi.mock("@/components/pasture/useIdleBehaviour", () => ({
  useIdleBehaviour: () => undefined,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import type { HabitatZone } from "@/lib/pasture/zones";
import type { Placement } from "@/components/pasture/PastureZone";

function makeReviewState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 21,
    reps: 3,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-06-01",
    lastReview: "2026-05-11",
    firstSeen: "2026-05-01",
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

const GRASSLAND_ZONE: HabitatZone = {
  habitat: "grassland",
  label: "Grassland",
  subRegions: [
    {
      id: "grassland-main",
      name: "Main",
      anchorSlots: [
        { x: 0.25, y: 0.75 },
        { x: 0.75, y: 0.75 },
      ],
    },
  ],
};

function makePlacement(card: NameReviewCard): Placement {
  return {
    card,
    subRegion: GRASSLAND_ZONE.subRegions[0],
    anchor: { x: 0.5, y: 0.8 },
  };
}

// ---------------------------------------------------------------------------
// Import component under test after mocks
// ---------------------------------------------------------------------------

import { PastureZone } from "@/components/pasture/PastureZone";

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUseLocalePokemonName.mockReturnValue({ name: "Bulbasaur", transliteration: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PastureZone - rendering placements (covers line 186 / diff gate)", () => {
  it("renders a sprite image for a placed card", () => {
    const card = makeCard();
    const placements = [makePlacement(card)];
    renderWithIntl(
      <PastureZone
        zone={GRASSLAND_ZONE}
        placements={placements}
        onMarkSeen={vi.fn()}
      />,
    );
    // PasturePokemon renders <img alt="Bulbasaur"> - the line-186 .map body executes.
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
  });

  it("renders a sprite for each placement in the zone", () => {
    const card1 = makeCard({ id: 1, speciesId: 1, displayName: "Bulbasaur", name: "Bulbasaur", subjectKey: "1" });
    const card2 = makeCard({ id: 2, speciesId: 4, displayName: "Charmander", name: "Charmander", subjectKey: "4", spriteUrl: "/sprites/pokemon/4.png" });
    mockUseLocalePokemonName
      .mockReturnValueOnce({ name: "Bulbasaur", transliteration: null })
      .mockReturnValueOnce({ name: "Charmander", transliteration: null });

    const placements = [makePlacement(card1), makePlacement(card2)];
    renderWithIntl(
      <PastureZone
        zone={GRASSLAND_ZONE}
        placements={placements}
        onMarkSeen={vi.fn()}
      />,
    );
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByAltText("Charmander")).toBeInTheDocument();
  });

  it("renders the zone section with an accessible label", () => {
    const placements = [makePlacement(makeCard())];
    renderWithIntl(
      <PastureZone
        zone={GRASSLAND_ZONE}
        placements={placements}
        onMarkSeen={vi.fn()}
      />,
    );
    // The section has aria-label={t("zoneAriaLabel", { zone: zoneLabel })}
    expect(screen.getByRole("region")).toBeInTheDocument();
  });
});

describe("PastureZone - empty placements", () => {
  it("renders the zone with no sprites when placements is empty", () => {
    renderWithIntl(
      <PastureZone
        zone={GRASSLAND_ZONE}
        placements={[]}
        onMarkSeen={vi.fn()}
      />,
    );
    expect(screen.queryByAltText("Bulbasaur")).not.toBeInTheDocument();
    // Zone section still renders.
    expect(screen.getByRole("region")).toBeInTheDocument();
  });
});

describe("PastureZone - biomeHref prop (optional link)", () => {
  it("renders the landscape link when biomeHref is provided", () => {
    const placements = [makePlacement(makeCard())];
    renderWithIntl(
      <PastureZone
        zone={GRASSLAND_ZONE}
        placements={placements}
        onMarkSeen={vi.fn()}
        biomeHref="/pasture/grassland"
      />,
    );
    expect(screen.getByRole("link")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/pasture/grassland");
  });

  it("does not render a landscape link when biomeHref is omitted", () => {
    renderWithIntl(
      <PastureZone
        zone={GRASSLAND_ZONE}
        placements={[]}
        onMarkSeen={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
