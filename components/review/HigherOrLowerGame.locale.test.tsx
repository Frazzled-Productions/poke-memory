/**
 * Locale-rendering tests for HigherOrLowerGame PokemonTile (F15, issue #1852).
 *
 * Verifies that PokemonTile resolves locale names via useLocalePokemonName
 * rather than rendering the raw English seed name.
 */

import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { HigherOrLowerGame } from "@/components/review/HigherOrLowerGame";
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

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => ({ miniGameBestScore: 0 }),
  saveSettings: vi.fn(),
}));

const { mockPickPair, mockShufflePair } = vi.hoisted(() => ({
  mockPickPair: vi.fn(),
  mockShufflePair: vi.fn(),
}));

vi.mock("@/lib/minigame/higherOrLower", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minigame/higherOrLower")>();
  return {
    ...actual,
    pickPair: (...args: Parameters<typeof actual.pickPair>) => mockPickPair(...args),
    shufflePair: (pair: ReturnType<typeof actual.pickPair>) => mockShufflePair(pair),
  };
});

// currentLocale drives the mock resolution.
let currentLocale = "en";

const LOCALE_NAMES: Record<number, Record<string, string>> = {
  1:  { en: "Bulbasaur", ja: "フシギダネ", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" },
  25: { en: "Pikachu",   ja: "ピカチュウ", "zh-Hans": "皮卡丘",   "zh-Hant": "皮卡丘"   },
};

vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (speciesId: number | undefined, englishName: string) => {
    const name =
      speciesId !== undefined
        ? (LOCALE_NAMES[speciesId]?.[currentLocale] ?? englishName)
        : englishName;
    return { name, transliteration: null };
  },
}));

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({ locale: currentLocale, languagesEnabled: true, learningLocales: ["en"] }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePokemon(id: number, name: string, attack: number): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: name,
    name,
    spriteUrl: `https://example.com/${name.toLowerCase()}.png`,
    types: ["normal"],
    stats: { hp: 50, attack, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
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
  };
}

const BULBASAUR = makePokemon(1, "Bulbasaur", 49);
const PIKACHU   = makePokemon(25, "Pikachu", 55);
const SEEN: SeedPokemon[] = [BULBASAUR, PIKACHU];
const FIXED_PAIR = { left: BULBASAUR, right: PIKACHU, stat: "attack" as const };

beforeEach(() => {
  vi.clearAllMocks();
  mockPickPair.mockReturnValue(FIXED_PAIR);
  mockShufflePair.mockImplementation((pair: typeof FIXED_PAIR) => pair);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HigherOrLowerGame PokemonTile - locale name rendering (F15, #1852)", () => {
  it("en locale: renders English names as button label and alt text", () => {
    currentLocale = "en";
    renderWithIntl(<HigherOrLowerGame seenPokemon={SEEN} />);
    expect(screen.getByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pikachu" })).toBeInTheDocument();
  });

  it("ja locale: renders Japanese names (フシギダネ, ピカチュウ) not English", () => {
    currentLocale = "ja";
    renderWithIntl(<HigherOrLowerGame seenPokemon={SEEN} />);
    expect(screen.getByRole("button", { name: "フシギダネ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ピカチュウ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulbasaur" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pikachu" })).not.toBeInTheDocument();
  });

  it("zh-Hans locale: renders Simplified Chinese names (妙蛙种子, 皮卡丘)", () => {
    currentLocale = "zh-Hans";
    renderWithIntl(<HigherOrLowerGame seenPokemon={SEEN} />);
    expect(screen.getByRole("button", { name: "妙蛙种子" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "皮卡丘" })).toBeInTheDocument();
  });

  it("zh-Hant locale: renders Traditional Chinese names (妙蛙種子, 皮卡丘)", () => {
    currentLocale = "zh-Hant";
    renderWithIntl(<HigherOrLowerGame seenPokemon={SEEN} />);
    expect(screen.getByRole("button", { name: "妙蛙種子" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "皮卡丘" })).toBeInTheDocument();
  });

  it("ja locale: alt text on sprite img also uses Japanese name", () => {
    currentLocale = "ja";
    renderWithIntl(<HigherOrLowerGame seenPokemon={SEEN} />);
    expect(screen.getByAltText("フシギダネ")).toBeInTheDocument();
    expect(screen.getByAltText("ピカチュウ")).toBeInTheDocument();
  });

  it("ja locale: name paragraph carries lang='ja' attribute", () => {
    currentLocale = "ja";
    const { container } = renderWithIntl(<HigherOrLowerGame seenPokemon={SEEN} />);
    const langPs = container.querySelectorAll("p[lang='ja']");
    expect(langPs.length).toBeGreaterThan(0);
  });
});
