/**
 * Component tests for PokedexGrid locale-name rendering.
 *
 * Verifies that when `localeNames` is supplied, cells display the resolved
 * locale name with a `lang` attribute, and fall back to the English name when
 * no override is present.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { PokemonCellData } from "@/lib/pokemon/filter";
import type { LocaleNameOverride } from "@/components/pokedex/PokedexGrid";

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

function makeCell(
  overrides: Partial<PokemonCellData> & { id: number; name: string },
): PokemonCellData {
  return {
    speciesId: overrides.id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: overrides.name,
    spriteUrl: `/sprites/pokemon/${overrides.id}.png`,
    types: ["normal"],
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: "",
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardClass: "learning",
    ...overrides,
  };
}

const BULBASAUR = makeCell({ id: 1, name: "Bulbasaur", cardClass: "learning" });

// Import after mocks are registered.
import PokedexGrid from "@/components/pokedex/PokedexGrid";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PokedexGrid — locale name rendering", () => {
  it("renders the English name when no localeNames map is supplied", () => {
    render(<PokedexGrid pokemon={[BULBASAUR]} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
  });

  it("renders the locale name when a matching localeNames override exists", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    render(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByText("フシギダネ")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("applies the lang attribute to the visible name span when a locale override is present", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    render(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const nameSpan = screen.getByText("フシギダネ");
    expect(nameSpan).toHaveAttribute("lang", "ja");
  });

  it("does not apply a lang attribute when no locale override is present", () => {
    render(<PokedexGrid pokemon={[BULBASAUR]} />);
    const nameSpan = screen.getByText("Bulbasaur");
    // lang attribute should be absent (not set to anything) for English names.
    expect(nameSpan).not.toHaveAttribute("lang");
  });

  it("uses the English name in the aria-label link when no locale override is present", () => {
    render(<PokedexGrid pokemon={[BULBASAUR]} />);
    // Non-locked cell: aria-label equals the display name.
    expect(screen.getByRole("link", { name: "Bulbasaur" })).toBeInTheDocument();
  });

  it("uses the locale name in the aria-label link when a locale override is present", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    render(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByRole("link", { name: "フシギダネ" })).toBeInTheDocument();
  });

  it("falls back to the English name when localeNames map has no entry for this species", () => {
    // Provide a map that has an entry for speciesId 99, not for 1.
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [99, { name: "Unrelated", lang: "ja" }],
    ]);
    render(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
  });
});
