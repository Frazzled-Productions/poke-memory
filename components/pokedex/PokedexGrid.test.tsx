/**
 * Smoke tests for PokedexGrid.
 *
 * Exercises the empty-state path (line 217) so the `mutedText` class-name
 * refactor on the "No Pokémon match your filters" paragraph is instrumented
 * by the coverage gate.
 */

import { describe, it, expect, vi } from "vitest";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
import type { PokemonCellData } from "@/lib/pokemon/filter";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false } }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CELL: PokemonCellData = {
  id: 1,
  speciesId: 1,
  isDefaultForm: true,
  formCategory: "default",
  formSlug: null,
  name: "Bulbasaur",
  displayName: "Bulbasaur",
  spriteUrl: "/sprites/pokemon/1.png",
  types: ["grass", "poison"],
  stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
  flavorText: "A strange seed.",
  flavorTexts: ["A strange seed."],
  evolutionChain: [],
  height: 7,
  weight: 69,
  baseExperience: 64,
  genus: "Seed Pokémon",
  generation: "generation-i",
  captureRate: null,
  baseHappiness: null,
  growthRate: null,
  habitat: null,
  genderRate: null,
  isLegendary: false,
  isMythical: false,
  cryUrl: null,
  cardClass: "locked",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Import after mocks are registered.
import PokedexGrid, { LoadingSkeleton } from "@/components/pokedex/PokedexGrid";

describe("PokedexGrid", () => {
  it("renders the empty-state message when pokemon list is empty (line 217)", () => {
    renderWithIntl(<PokedexGrid pokemon={[]} />);
    expect(
      screen.getByText(/no pokémon match your filters/i),
    ).toBeInTheDocument();
  });

  it("renders a Clear filters link in the empty state", () => {
    renderWithIntl(<PokedexGrid pokemon={[]} />);
    expect(
      screen.getByRole("link", { name: /clear filters/i }),
    ).toHaveAttribute("href", "/pokedex");
  });

  it("renders a grid of pokemon cells when data is provided", () => {
    renderWithIntl(<PokedexGrid pokemon={[CELL]} />);
    // When no activeGen is set the grid renders a flat list.
    // The cell uses the name as aria-label when not locked; locked cells use
    // "Pokémon #NNN". CELL has cardClass "locked" so an aria-label link is
    // rendered - we simply confirm a link pointing to the detail page exists.
    expect(screen.getByRole("link", { name: /001/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LoadingSkeleton - exercises the useTranslations call and the
// localised aria-label added in #1607.
// ---------------------------------------------------------------------------

describe("LoadingSkeleton", () => {
  it("renders with aria-busy and an aria-label in English", () => {
    const { container } = renderWithIntl(<LoadingSkeleton />);
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.getAttribute("aria-label")).toBe("Loading Pokédex");
  });

  it("aria-label is localised in Japanese", () => {
    const { container } = renderJa(<LoadingSkeleton />);
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy?.getAttribute("aria-label")).toBe("Pokédex を読み込み中");
  });
});
