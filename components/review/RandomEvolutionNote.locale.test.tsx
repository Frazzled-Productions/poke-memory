/**
 * Locale-rendering tests for RandomEvolutionNote (#1932).
 *
 * Verifies that the Wurmple random-evolution caption resolves the pre-evo
 * name and both sibling names through `useLocalePokemonName` (never the raw
 * English fallback), and that each name is wrapped in a `lang`-tagged span
 * when the active Pokémon-name locale differs from English.
 *
 * Strategy: mock `useLocalePokemonName` to simulate sidecar-resolved locale
 * names and `usePokemonLocaleContext` to supply the active locale, matching
 * the pattern in EvolutionWall.locale.test.tsx / HigherOrLowerGame.locale.test.tsx.
 */

import { describe, it, expect, vi } from "vitest";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
  screen,
} from "@/components/test-utils/renderWithIntl";
import { RandomEvolutionNote } from "@/components/review/RandomEvolutionNote";

// Wurmple = 265, Silcoon = 266, Cascoon = 268.
const LOCALE_NAMES: Record<number, Record<string, string>> = {
  265: { en: "Wurmple", ja: "ケムッソ", "zh-Hans": "刺尾虫", "zh-Hant": "刺尾蟲" },
  266: { en: "Silcoon", ja: "カラサリス", "zh-Hans": "甲壳茧", "zh-Hant": "甲殼繭" },
  268: { en: "Cascoon", ja: "マユルド", "zh-Hans": "盾甲茧", "zh-Hant": "盾甲繭" },
};

// currentLocale is set per-test so the single module-level mock resolves it.
let currentLocale = "en";

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
  usePokemonLocaleContext: () => ({
    locale: currentLocale,
    languagesEnabled: true,
    learningLocales: ["en"],
  }),
}));

describe("RandomEvolutionNote - locale rendering (#1932)", () => {
  it("en locale: renders English names, no lang attribute on the name spans", () => {
    currentLocale = "en";
    const { container } = renderWithIntl(
      <RandomEvolutionNote preEvoId={265} preEvoName="Wurmple" />,
    );

    expect(screen.getByText("Wurmple")).toBeInTheDocument();
    expect(screen.getByText("Silcoon")).toBeInTheDocument();
    expect(screen.getByText("Cascoon")).toBeInTheDocument();
    expect(container.querySelectorAll("span[lang]").length).toBe(0);
  });

  it("ja locale: renders Japanese names inside lang='ja' spans", () => {
    currentLocale = "ja";
    const { container } = renderJa(
      <RandomEvolutionNote preEvoId={265} preEvoName="Wurmple" />,
    );

    expect(screen.getByText("ケムッソ")).toBeInTheDocument();
    expect(screen.getByText("カラサリス")).toBeInTheDocument();
    expect(screen.getByText("マユルド")).toBeInTheDocument();
    expect(screen.queryByText("Wurmple")).not.toBeInTheDocument();
    expect(screen.queryByText("Silcoon")).not.toBeInTheDocument();
    expect(screen.queryByText("Cascoon")).not.toBeInTheDocument();

    const langSpans = container.querySelectorAll("span[lang='ja']");
    expect(langSpans.length).toBe(3);
  });

  it("zh-Hans locale: renders Simplified Chinese names inside lang='zh-Hans' spans", () => {
    currentLocale = "zh-Hans";
    const { container } = renderZhHans(
      <RandomEvolutionNote preEvoId={265} preEvoName="Wurmple" />,
    );

    expect(screen.getByText("刺尾虫")).toBeInTheDocument();
    expect(screen.getByText("甲壳茧")).toBeInTheDocument();
    expect(screen.getByText("盾甲茧")).toBeInTheDocument();

    const langSpans = container.querySelectorAll("span[lang='zh-Hans']");
    expect(langSpans.length).toBe(3);
  });

  it("zh-Hant locale: renders Traditional Chinese names inside lang='zh-Hant' spans", () => {
    currentLocale = "zh-Hant";
    const { container } = renderZhHant(
      <RandomEvolutionNote preEvoId={265} preEvoName="Wurmple" />,
    );

    expect(screen.getByText("刺尾蟲")).toBeInTheDocument();
    expect(screen.getByText("甲殼繭")).toBeInTheDocument();
    expect(screen.getByText("盾甲繭")).toBeInTheDocument();

    const langSpans = container.querySelectorAll("span[lang='zh-Hant']");
    expect(langSpans.length).toBe(3);
  });

  it("returns null (renders nothing) for a pre-evo id with no random-branch entry", () => {
    currentLocale = "en";
    const { container } = renderWithIntl(
      <RandomEvolutionNote preEvoId={4} preEvoName="Charmander" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
