/**
 * Smoke tests for PokedexGrid.
 *
 * Exercises the empty-state path (line 217) so the `mutedText` class-name
 * refactor on the "No Pokémon match your filters" paragraph is instrumented
 * by the coverage gate.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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
import PokedexGrid from "@/components/pokedex/PokedexGrid";

describe("PokedexGrid", () => {
  it("renders the empty-state message when pokemon list is empty (line 217)", () => {
    render(<PokedexGrid pokemon={[]} />);
    expect(
      screen.getByText(/no pokémon match your filters/i),
    ).toBeInTheDocument();
  });

  it("renders a Clear filters link in the empty state", () => {
    render(<PokedexGrid pokemon={[]} />);
    expect(
      screen.getByRole("link", { name: /clear filters/i }),
    ).toHaveAttribute("href", "/pokedex");
  });

  it("renders a grid of pokemon cells when data is provided", () => {
    render(<PokedexGrid pokemon={[CELL]} />);
    // When no activeGen is set the grid renders a flat list.
    // The cell uses the name as aria-label when not locked; locked cells use
    // "Pokémon #NNN". CELL has cardClass "locked" so an aria-label link is
    // rendered — we simply confirm a link pointing to the detail page exists.
    expect(screen.getByRole("link", { name: /001/i })).toBeInTheDocument();
  });
});
