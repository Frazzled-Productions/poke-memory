/**
 * Component tests for stats/LanguageBreakdown (issue #1619).
 *
 * Covers:
 *   1. Gate: single locale ["en"] - heading absent.
 *   2. Gate: languagesEnabled false - heading absent even with multiple locales.
 *   3. Multi-locale ["en","ja"]: heading renders, ja endonym has lang="ja", card count,
 *      mastery %, and last-review (or "Not yet reviewed") render per locale.
 *   4. ["en","zh-Hans"]: endonym with lang="zh-Hans".
 *   5. ["en","zh-Hant"]: endonym with lang="zh-Hant".
 *   6. All-four ["en","ja","zh-Hans","zh-Hant"]: all four rows present.
 *   7. pretendAllMastered ON → 100% mastery per locale.
 *   8. Empty/no-reviews state: "Not yet reviewed" per locale.
 *   9. UI locale switching (ja, zh-Hans, zh-Hant heading translations).
 */

import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { LanguageBreakdown, type LanguageBreakdownProps } from "./LanguageBreakdown";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed";
import { MASTERY_REPETITIONS, MASTERY_INTERVAL_DAYS } from "@/lib/stats/derive";
import type { AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockLocaleCtx, mockSuperuserValue } = vi.hoisted(() => ({
  mockLocaleCtx: {
    locale: "en" as AppLocale,
    languagesEnabled: true,
    learningLocales: ["en", "ja"] as AppLocale[],
  },
  mockSuperuserValue: {
    flags: { pretendAllMastered: false },
    anyFlagOn: false,
  },
}));

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => mockLocaleCtx,
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockSuperuserValue,
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
  EVOLUTION_ID_OFFSET: 1_000_000,
  REVERSE_ID_OFFSET: 2_000_000,
  REVERSE_EDGE_ID_BASE: 2_500_000,
  CRY_ID_OFFSET: 3_000_000,
}));

// ---------------------------------------------------------------------------
// Card factories
// ---------------------------------------------------------------------------

function nameCard(id: number, locale: AppLocale = "en", mastered = false, lastReview: string | null = null): NameReviewCard {
  const lr = mastered ? (lastReview ?? "2026-01-01") : lastReview;
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default" as const,
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `Pokemon${id}`,
    spriteUrl: "",
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A pokemon.",
    flavorTexts: ["A pokemon."],
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
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name" as const,
    subjectKey: String(id),
    locale,
    state: {
      stability: mastered ? 30 : 0,
      difficulty: mastered ? 5 : 0,
      elapsedDays: 0,
      scheduledDays: mastered ? MASTERY_INTERVAL_DAYS : 0,
      reps: mastered ? MASTERY_REPETITIONS : 0,
      lapses: 0,
      fsrsState: mastered ? ("review" as const) : ("new" as const),
      dueDate: "2099-01-01",
      lastReview: lr,
      firstSeen: mastered ? "2025-12-01" : null,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

function reverseCard(speciesId: number, locale: AppLocale = "en", mastered = false): ReverseReviewCard {
  const base = nameCard(speciesId, locale, mastered);
  return {
    ...base,
    id: REVERSE_ID_OFFSET + speciesId,
    cardType: "reverse" as const,
    pokemonId: speciesId,
    subjectKey: String(speciesId),
  };
}

// ---------------------------------------------------------------------------
// Default props factory
// ---------------------------------------------------------------------------

const TODAY = "2026-06-04";

function defaultProps(overrides: Partial<LanguageBreakdownProps> = {}): LanguageBreakdownProps {
  return {
    cards: [],
    today: TODAY,
    masteryRepetitions: MASTERY_REPETITIONS,
    dateFormat: "dmy",
    timezone: "UTC",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLocaleCtx.languagesEnabled = true;
  mockLocaleCtx.learningLocales = ["en", "ja"];
  mockSuperuserValue.flags = { pretendAllMastered: false };
  mockSuperuserValue.anyFlagOn = false;
});

// ---------------------------------------------------------------------------
// Gate: single locale / flag off
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - gate: single locale", () => {
  it("does NOT render the heading when learningLocales has only ['en']", () => {
    mockLocaleCtx.learningLocales = ["en"];
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    expect(screen.queryByRole("heading", { name: /languages/i })).not.toBeInTheDocument();
  });

  it("does NOT render when languagesEnabled is false even with multiple locales", () => {
    mockLocaleCtx.languagesEnabled = false;
    mockLocaleCtx.learningLocales = ["en", "ja"];
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    expect(screen.queryByRole("heading", { name: /languages/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Multi-locale ["en","ja"]
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - multi-locale ['en','ja']", () => {
  it("renders the Languages heading when enrolled in en + ja", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    expect(screen.getByRole("heading", { name: "Languages" })).toBeInTheDocument();
  });

  it("renders the ja endonym with lang='ja'", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    const jaSpan = document.querySelector('span[lang="ja"]');
    expect(jaSpan).not.toBeNull();
    expect(jaSpan?.textContent).toBe("日本語");
  });

  it("renders card count for each locale", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, "en"),
      nameCard(2, "en"),
      reverseCard(1, "en"),
      nameCard(3, "ja"),
      reverseCard(3, "ja"),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    // en: 2 name cards; ja: 1 name card
    expect(screen.getByText("2 cards")).toBeInTheDocument();
    expect(screen.getByText("1 card")).toBeInTheDocument();
  });

  it("renders mastery percentage per locale", () => {
    // 2 mastered en species + 1 mastered ja species
    const cards: ReviewableCard[] = [
      nameCard(1, "en", true),
      reverseCard(1, "en", true),
      nameCard(2, "en", true),
      reverseCard(2, "en", true),
      nameCard(3, "ja", true),
      reverseCard(3, "ja", true),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    // en: 2 mastered / 2 total = 100%; ja: 1 mastered / 1 total = 100%
    const masteredEls = screen.getAllByText("100% mastered");
    expect(masteredEls.length).toBe(2);
  });

  it("renders last review date from name cards when available", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, "en", false, "2026-05-15"),
      nameCard(3, "ja", false, "2026-04-20"),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    // formatDate("2026-05-15", "dmy", "UTC") → e.g. "Fri, 15 May" (en-GB, no year)
    // Assert the "Last reviewed …" text is present for each locale using a
    // substring match on the month name so the test is not brittle to weekday.
    expect(screen.getByText(/Last reviewed.*15 May/)).toBeInTheDocument();
    expect(screen.getByText(/Last reviewed.*20 Apr/)).toBeInTheDocument();
  });

  it("renders 'Not yet reviewed' when locale has no reviewed cards", () => {
    // No cards at all → both locales show "Not yet reviewed"
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    const neverEls = screen.getAllByText("Not yet reviewed");
    expect(neverEls.length).toBe(2);
  });

  it("renders 'Not yet reviewed' only for the locale with no reviews", () => {
    const cards: ReviewableCard[] = [
      nameCard(1, "en", false, "2026-06-01"),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    // en has a review date: "Last reviewed ..." text present
    expect(screen.getByText(/Last reviewed/)).toBeInTheDocument();
    // ja has no reviews: "Not yet reviewed" present
    expect(screen.getByText("Not yet reviewed")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ["en","zh-Hans"]
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - ['en','zh-Hans']", () => {
  it("renders zh-Hans endonym with lang='zh-Hans'", () => {
    mockLocaleCtx.learningLocales = ["en", "zh-Hans"];
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    const zhSpan = document.querySelector('span[lang="zh-Hans"]');
    expect(zhSpan).not.toBeNull();
    expect(zhSpan?.textContent).toBe("简体中文");
  });
});

// ---------------------------------------------------------------------------
// ["en","zh-Hant"]
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - ['en','zh-Hant']", () => {
  it("renders zh-Hant endonym with lang='zh-Hant'", () => {
    mockLocaleCtx.learningLocales = ["en", "zh-Hant"];
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    const zhSpan = document.querySelector('span[lang="zh-Hant"]');
    expect(zhSpan).not.toBeNull();
    expect(zhSpan?.textContent).toBe("繁體中文");
  });
});

// ---------------------------------------------------------------------------
// All-four locales
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - all four locales ['en','ja','zh-Hans','zh-Hant']", () => {
  it("renders all four rows with correct lang attributes", () => {
    mockLocaleCtx.learningLocales = ["en", "ja", "zh-Hans", "zh-Hant"];
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    // ja
    const jaSpan = document.querySelector('span[lang="ja"]');
    expect(jaSpan?.textContent).toBe("日本語");
    // zh-Hans
    const zhHansSpan = document.querySelector('span[lang="zh-Hans"]');
    expect(zhHansSpan?.textContent).toBe("简体中文");
    // zh-Hant
    const zhHantSpan = document.querySelector('span[lang="zh-Hant"]');
    expect(zhHantSpan?.textContent).toBe("繁體中文");
    // English (no lang attr needed - it's the document language)
    expect(screen.getByText("English")).toBeInTheDocument();
    // 4 rows → 4 "Not yet reviewed"
    const neverEls = screen.getAllByText("Not yet reviewed");
    expect(neverEls.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// pretendAllMastered superuser flag
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - pretendAllMastered ON", () => {
  it("shows 100% mastered per locale when forceAllMastered is on", () => {
    mockSuperuserValue.flags = { pretendAllMastered: true };
    mockSuperuserValue.anyFlagOn = true;
    // Cards not naturally mastered
    const cards: ReviewableCard[] = [
      nameCard(1, "en", false),
      nameCard(2, "en", false),
      nameCard(3, "ja", false),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    const masteredEls = screen.getAllByText("100% mastered");
    expect(masteredEls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Empty cards state (0% mastery)
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - empty cards state", () => {
  it("shows 0% mastered when there are no cards for a locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards: [] })} />);
    const zeroEls = screen.getAllByText("0% mastered");
    expect(zeroEls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// UI locale translations (heading)
// ---------------------------------------------------------------------------

describe("LanguageBreakdown - UI locale heading translations", () => {
  it("renders the heading in Japanese UI locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />, { locale: "ja" });
    // ja: stats.languageBreakdown.heading = "言語"
    expect(screen.getByRole("heading", { name: "言語" })).toBeInTheDocument();
  });

  it("renders the heading in Simplified Chinese UI locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />, { locale: "zh-Hans" });
    // zh-Hans: stats.languageBreakdown.heading = "语言"
    expect(screen.getByRole("heading", { name: "语言" })).toBeInTheDocument();
  });

  it("renders the heading in Traditional Chinese UI locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />, { locale: "zh-Hant" });
    // zh-Hant: stats.languageBreakdown.heading = "語言"
    expect(screen.getByRole("heading", { name: "語言" })).toBeInTheDocument();
  });
});
