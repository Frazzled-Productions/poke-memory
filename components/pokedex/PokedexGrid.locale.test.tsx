/**
 * Component tests for PokedexGrid locale-name rendering.
 *
 * Verifies that when `localeNames` is supplied, cells display the resolved
 * locale name with a `lang` attribute, and fall back to the English name when
 * no override is present.
 */

import { describe, it, expect, vi } from "vitest";
import {
  renderWithIntl,
  renderJa,
  screen,
} from "@/components/test-utils/renderWithIntl";
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

describe("PokedexGrid - locale name rendering", () => {
  it("renders the English name when no localeNames map is supplied", () => {
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
  });

  it("renders the locale name when a matching localeNames override exists", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByText("フシギダネ")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("applies the lang attribute to the visible name span when a locale override is present", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const nameSpan = screen.getByText("フシギダネ");
    expect(nameSpan).toHaveAttribute("lang", "ja");
  });

  it("does not apply a lang attribute when no locale override is present", () => {
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} />);
    const nameSpan = screen.getByText("Bulbasaur");
    // lang attribute should be absent (not set to anything) for English names.
    expect(nameSpan).not.toHaveAttribute("lang");
  });

  it("uses the English name in the aria-label link when no locale override is present", () => {
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} />);
    // Non-locked cell: aria-label equals the display name.
    expect(screen.getByRole("link", { name: "Bulbasaur" })).toBeInTheDocument();
  });

  it("uses the locale name in the aria-label link when a locale override is present", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByRole("link", { name: "フシギダネ" })).toBeInTheDocument();
  });

  it("falls back to the English name when localeNames map has no entry for this species", () => {
    // Provide a map that has an entry for speciesId 99, not for 1.
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [99, { name: "Unrelated", lang: "ja" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
  });

  // ─── Simplified Chinese (zh-Hans) ──────────────────────────────────────────

  it("renders the Simplified Chinese name when zh-Hans locale override is present", () => {
    // Bulbasaur in zh-Hans: 妙蛙种子
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙种子", lang: "zh-Hans" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByText("妙蛙种子")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("applies lang=zh-Hans to the name span when a zh-Hans override is present", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙种子", lang: "zh-Hans" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const nameSpan = screen.getByText("妙蛙种子");
    expect(nameSpan).toHaveAttribute("lang", "zh-Hans");
  });

  // ─── Traditional Chinese (zh-Hant) ─────────────────────────────────────────

  it("renders the Traditional Chinese name when zh-Hant locale override is present", () => {
    // Bulbasaur in zh-Hant: 妙蛙種子 (different final character from zh-Hans 种子 vs 種子)
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙種子", lang: "zh-Hant" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    expect(screen.getByText("妙蛙種子")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("applies lang=zh-Hant to the name span when a zh-Hant override is present", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙種子", lang: "zh-Hant" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const nameSpan = screen.getByText("妙蛙種子");
    expect(nameSpan).toHaveAttribute("lang", "zh-Hant");
  });

  it("distinguishes zh-Hans from zh-Hant by final character (种子 vs 種子)", () => {
    // This test exists to ensure the two locales are genuinely distinct - a
    // renderer that collapses them would fail here.
    const hansMap: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙种子", lang: "zh-Hans" }],
    ]);
    const hantMap: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙種子", lang: "zh-Hant" }],
    ]);
    const { unmount } = renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={hansMap} />);
    expect(screen.getByText("妙蛙种子")).toHaveAttribute("lang", "zh-Hans");
    expect(screen.queryByText("妙蛙種子")).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={hantMap} />);
    expect(screen.getByText("妙蛙種子")).toHaveAttribute("lang", "zh-Hant");
    expect(screen.queryByText("妙蛙种子")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WebP src assertion - locale matrix (#1740)
// The grid now renders the 64 px WebP variant for every tile regardless of
// locale. Verified here for all four supported locales to confirm the
// spriteVariantUrl(id, POKEDEX_GRID_SPRITE_SIZE) path is emitted correctly
// and does not accidentally regress to the raw PNG path.
// ---------------------------------------------------------------------------

describe("PokedexGrid - WebP sprite src across all locales (#1740)", () => {
  const EXPECTED_SRC = "/sprites/pokemon/webp/1/64.webp";

  it("renders the 64 px WebP src in English (en)", () => {
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} />);
    const img = document.querySelector(`img[src="${EXPECTED_SRC}"]`);
    expect(img).not.toBeNull();
  });

  it("renders the 64 px WebP src with a Japanese locale override", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "フシギダネ", lang: "ja" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const img = document.querySelector(`img[src="${EXPECTED_SRC}"]`);
    expect(img).not.toBeNull();
  });

  it("renders the 64 px WebP src with a Simplified Chinese locale override", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙种子", lang: "zh-Hans" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const img = document.querySelector(`img[src="${EXPECTED_SRC}"]`);
    expect(img).not.toBeNull();
  });

  it("renders the 64 px WebP src with a Traditional Chinese locale override", () => {
    const localeNames: ReadonlyMap<number, LocaleNameOverride> = new Map([
      [1, { name: "妙蛙種子", lang: "zh-Hant" }],
    ]);
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} localeNames={localeNames} />);
    const img = document.querySelector(`img[src="${EXPECTED_SRC}"]`);
    expect(img).not.toBeNull();
  });

  it("does NOT render a raw PNG src for any tile", () => {
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} />);
    const pngImg = document.querySelector('img[src$=".png"]');
    expect(pngImg).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// masteryCount label locale coverage (#1393)
// ---------------------------------------------------------------------------

describe("PokedexGrid - masteryCount label locale coverage (#1393)", () => {
  it("renders the English mastery count label in en locale", () => {
    // BULBASAUR has cardClass: 'learning', so mastered=0, total=1
    renderWithIntl(<PokedexGrid pokemon={[BULBASAUR]} />);
    // pokedex.masteryCount = "{mastered} / {total} mastered" → "0 / 1 mastered"
    expect(screen.getByText(/0 \/ 1 mastered/)).toBeInTheDocument();
  });

  it("renders the Japanese mastery count label in ja locale", () => {
    renderJa(<PokedexGrid pokemon={[BULBASAUR]} />);
    // ja pokedex.masteryCount = "{mastered} / {total} 習得済み" → "0 / 1 習得済み"
    expect(screen.getByText(/0 \/ 1 習得済み/)).toBeInTheDocument();
  });
});
