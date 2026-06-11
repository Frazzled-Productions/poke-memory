/**
 * Locale-rendering tests for EvolutionWall (F13, issue #1852).
 *
 * Verifies that SpeciesNode renders the locale-resolved name (not the raw
 * English seed name) in all four supported locales.
 *
 * Strategy: mock `useLocalePokemonName` to simulate sidecar-resolved locale
 * names and `usePokemonLocaleContext` to supply the active locale, so tests
 * are deterministic without network calls.
 */

import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { EvolutionWall } from "./EvolutionWall";
import type { EvolutionFamily, FamilyEdge, FamilyNode } from "@/lib/evolution/chains";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// Locale names keyed by speciesId per locale - used by the mock below.
const LOCALE_NAMES: Record<number, Record<string, string>> = {
  1: { en: "Bulbasaur", ja: "フシギダネ", "zh-Hans": "妙蛙种子", "zh-Hant": "妙蛙種子" },
  2: { en: "Ivysaur",   ja: "フシギソウ", "zh-Hans": "妙蛙草",   "zh-Hant": "妙蛙草"   },
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
  usePokemonLocaleContext: () => ({ locale: currentLocale, languagesEnabled: true, learningLocales: ["en"] }),
}));

// getLocaleNamesSnapshot is called in LinearChain/BranchingTree; return an
// empty map (edge aria-labels fall back to English) since we're not testing
// edge labels in these locale tests.
vi.mock("@/lib/pokemon/localeNames", () => ({
  getLocaleName: (speciesId: number, locale: string) =>
    LOCALE_NAMES[speciesId]?.[locale],
  getTransliteration: () => undefined,
  getLocaleNamesSnapshot: () => new Map(),
  loadLocaleNames: () => Promise.resolve(new Map()),
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeNode(speciesId: number, name: string): FamilyNode {
  return { speciesId, name, spriteUrl: `/sprites/pokemon/${speciesId}.png` };
}

function makeEdge(fromId: number, toId: number): FamilyEdge {
  return {
    forwardEdgeId: 1500000 + fromId,
    fromId,
    toId,
    forwardMastered: false,
    reverseMastered: false,
    fullyMastered: false,
  };
}

function makeLinearFamily(): EvolutionFamily {
  return {
    rootId: 1,
    nodes: [makeNode(1, "Bulbasaur"), makeNode(2, "Ivysaur")],
    edges: [makeEdge(1, 2)],
    completed: false,
  };
}

function expandWall() {
  fireEvent.click(screen.getByRole("button", { name: /Expand|展開|展開する|展開/i }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvolutionWall - locale name rendering (F13, #1852)", () => {
  it("en locale: renders English names in SpeciesNode alt text and label", () => {
    currentLocale = "en";
    renderWithIntl(<EvolutionWall families={[makeLinearFamily()]} />);
    expandWall();
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByAltText("Ivysaur")).toBeInTheDocument();
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
  });

  it("ja locale: renders Japanese names (フシギダネ) not English Bulbasaur", () => {
    currentLocale = "ja";
    renderWithIntl(<EvolutionWall families={[makeLinearFamily()]} />);
    expandWall();
    expect(screen.getByAltText("フシギダネ")).toBeInTheDocument();
    expect(screen.getByAltText("フシギソウ")).toBeInTheDocument();
    expect(screen.getByText("フシギダネ")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("zh-Hans locale: renders Simplified Chinese names (妙蛙种子)", () => {
    currentLocale = "zh-Hans";
    renderWithIntl(<EvolutionWall families={[makeLinearFamily()]} />);
    expandWall();
    expect(screen.getByAltText("妙蛙种子")).toBeInTheDocument();
    expect(screen.getByText("妙蛙种子")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("zh-Hant locale: renders Traditional Chinese names (妙蛙種子)", () => {
    currentLocale = "zh-Hant";
    renderWithIntl(<EvolutionWall families={[makeLinearFamily()]} />);
    expandWall();
    expect(screen.getByAltText("妙蛙種子")).toBeInTheDocument();
    expect(screen.getByText("妙蛙種子")).toBeInTheDocument();
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("ja locale: name span carries lang='ja' attribute", () => {
    currentLocale = "ja";
    const { container } = renderWithIntl(<EvolutionWall families={[makeLinearFamily()]} />);
    expandWall();
    const jaSpans = container.querySelectorAll("span[lang='ja']");
    expect(jaSpans.length).toBeGreaterThan(0);
  });
});
