/**
 * Component tests for LanguageBreakdown (issue #1620).
 *
 * Covers:
 *   1. Single-language ["en"]: section is ABSENT (heading not rendered).
 *   2. Multi-language ["en","ja"]: section renders both rows; ja endonym "日本語"
 *      has lang="ja"; per-locale mastery counts and best-day render.
 *   3. Third locale render: ["en","zh-Hans"] renders "简体中文" with lang="zh-Hans".
 *   4. forceAllMastered / pretendAllMastered ON: per-locale mastery shows all-mastered.
 *   5. Empty/no-reviews state for an enrolled locale: best-day shows "No reviews yet".
 *   6. Languages flag off: section absent even when >1 learningLocales (defensive gate).
 *
 * Uses renderWithIntl so real message catalogues are exercised.
 */

import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { LanguageBreakdown, type LanguageBreakdownProps } from "./LanguageBreakdown";
import type { ReviewableCard, NameReviewCard, ReverseReviewCard } from "@/lib/review/session";
import type { GradeLog } from "@/lib/gradelog/persistence";
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

function nameCard(id: number, locale: AppLocale = "en", mastered = false): NameReviewCard {
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
      lastReview: mastered ? "2026-01-01" : null,
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
    gradeLog: [],
    today: TODAY,
    masteryRepetitions: MASTERY_REPETITIONS,
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

describe("LanguageBreakdown — gate: single locale", () => {
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

describe("LanguageBreakdown — multi-locale ['en','ja']", () => {
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

  it("renders per-locale mastery counts for both locales", () => {
    // 2 mastered en cards (both name + reverse) + 1 mastered ja card.
    const cards: ReviewableCard[] = [
      nameCard(1, "en", true),
      reverseCard(1, "en", true),
      nameCard(2, "en", true),
      reverseCard(2, "en", true),
      nameCard(3, "ja", true),
      reverseCard(3, "ja", true),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    // en: 2 mastered
    expect(screen.getByText("2 mastered")).toBeInTheDocument();
    // ja: 1 mastered
    expect(screen.getByText("1 mastered")).toBeInTheDocument();
  });

  it("renders best review day from grade log for each locale", () => {
    const log: GradeLog = [
      { date: "2026-06-01", grade: 4, cardType: "name", occurredAt: 1, locale: "en" },
      { date: "2026-06-01", grade: 4, cardType: "name", occurredAt: 2, locale: "en" },
      { date: "2026-06-01", grade: 4, cardType: "name", occurredAt: 3, locale: "en" },
      { date: "2026-06-01", grade: 4, cardType: "name", occurredAt: 4, locale: "ja" },
      { date: "2026-06-01", grade: 4, cardType: "name", occurredAt: 5, locale: "ja" },
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ gradeLog: log })} />);
    // en: 3 reviews on best day
    expect(screen.getByText("3 reviews on best day")).toBeInTheDocument();
    // ja: 2 reviews on best day
    expect(screen.getByText("2 reviews on best day")).toBeInTheDocument();
  });
});

describe("LanguageBreakdown — third locale ['en','zh-Hans']", () => {
  it("renders 'zh-Hans' endonym with lang='zh-Hans'", () => {
    mockLocaleCtx.learningLocales = ["en", "zh-Hans"];
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />);
    const zhSpan = document.querySelector('span[lang="zh-Hans"]');
    expect(zhSpan).not.toBeNull();
    expect(zhSpan?.textContent).toBe("简体中文");
  });
});

describe("LanguageBreakdown — pretendAllMastered superuser flag", () => {
  it("shows all cards mastered per locale when forceAllMastered is on", () => {
    mockSuperuserValue.flags = { pretendAllMastered: true };
    mockSuperuserValue.anyFlagOn = true;
    // 2 en name cards (not actually mastered) + 1 ja name card.
    const cards: ReviewableCard[] = [
      nameCard(1, "en", false),
      nameCard(2, "en", false),
      nameCard(3, "ja", false),
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ cards })} />);
    // With forceAllMastered, all 2 en name cards count as mastered.
    expect(screen.getByText("2 mastered")).toBeInTheDocument();
    // All 1 ja name card counts as mastered.
    expect(screen.getByText("1 mastered")).toBeInTheDocument();
  });
});

describe("LanguageBreakdown — empty/no-reviews state", () => {
  it("shows 'No reviews yet' for an enrolled locale with no grade log entries", () => {
    // gradeLog is empty — no reviews for any locale.
    renderWithIntl(<LanguageBreakdown {...defaultProps({ gradeLog: [] })} />);
    // Both locales should show "No reviews yet" (two instances).
    const noReviewEls = screen.getAllByText("No reviews yet");
    expect(noReviewEls.length).toBe(2);
  });

  it("shows 'No reviews yet' only for the locale with no entries", () => {
    const log: GradeLog = [
      { date: "2026-06-01", grade: 4, cardType: "name", occurredAt: 1, locale: "en" },
    ];
    renderWithIntl(<LanguageBreakdown {...defaultProps({ gradeLog: log })} />);
    // en has 1 review: "1 review on best day".
    expect(screen.getByText("1 review on best day")).toBeInTheDocument();
    // ja has 0 reviews: "No reviews yet".
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
  });
});

describe("LanguageBreakdown — locale rendering (app UI locale)", () => {
  it("renders the heading in Japanese UI locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />, { locale: "ja" });
    // ja: journey.languageBreakdown.heading = "言語"
    expect(screen.getByRole("heading", { name: "言語" })).toBeInTheDocument();
  });

  it("renders the heading in Simplified Chinese UI locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />, { locale: "zh-Hans" });
    // zh-Hans: journey.languageBreakdown.heading = "语言"
    expect(screen.getByRole("heading", { name: "语言" })).toBeInTheDocument();
  });

  it("renders the heading in Traditional Chinese UI locale", () => {
    renderWithIntl(<LanguageBreakdown {...defaultProps()} />, { locale: "zh-Hant" });
    // zh-Hant: journey.languageBreakdown.heading = "語言"
    expect(screen.getByRole("heading", { name: "語言" })).toBeInTheDocument();
  });
});
