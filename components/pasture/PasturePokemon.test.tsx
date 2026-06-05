import { renderWithIntl as render, screen, fireEvent, act } from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// useLocalePokemonName: controlled per-test via mockUseLocalePokemonName.
const mockUseLocalePokemonName = vi.fn();
vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (...args: Parameters<typeof mockUseLocalePokemonName>) =>
    mockUseLocalePokemonName(...args),
}));

// PokemonLocaleContext: default to English; tests that need non-English locale
// update mockPokemonLocale before rendering.
let mockPokemonLocale = "en";
vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({
    locale: mockPokemonLocale,
    languagesEnabled: false,
    learningLocales: ["en"],
  }),
  PokemonLocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Locale name fixtures (simulating what the real hook returns per locale
// for species 1 / Bulbasaur).
// ---------------------------------------------------------------------------

const LOCALE_NAMES: Record<string, string> = {
  en: "Bulbasaur",
  ja: "フシギダネ",
  "zh-Hans": "妙蛙种子",
  "zh-Hant": "妙蛙種子",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { NameReviewCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";

function makeReviewState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 1,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 1,
    reps: 1,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-19",
    lastReview: "2026-05-18",
    firstSeen: "2026-05-18",
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

// ---------------------------------------------------------------------------
// Import component under test after mocks
// ---------------------------------------------------------------------------

import { PasturePokemon } from "@/components/pasture/PasturePokemon";
import { PASTURE_SPRITE_SIZE } from "@/lib/sprites/sizes";

// ---------------------------------------------------------------------------
// Reset defaults before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPokemonLocale = "en";
  mockUseLocalePokemonName.mockReturnValue({ name: "Bulbasaur", transliteration: null });
});

// ---------------------------------------------------------------------------
// Tests - sprite rendering
// ---------------------------------------------------------------------------

describe("PasturePokemon - sprite rendering", () => {
  it("renders a sprite image with the locale-resolved name as alt text", () => {
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />);
    const img = screen.getByAltText("Bulbasaur");
    expect(img).toBeInTheDocument();
  });

  it("renders the sprite at the shared PASTURE_SPRITE_SIZE dimensions", () => {
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />);
    const img = screen.getByAltText("Bulbasaur");
    expect(img).toHaveAttribute("width", String(PASTURE_SPRITE_SIZE));
    expect(img).toHaveAttribute("height", String(PASTURE_SPRITE_SIZE));
  });

  it("renders the sprite src from the card's spriteUrl", () => {
    const spriteUrl = "/sprites/pokemon/25.png";
    const card = makeCard({ spriteUrl });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    const img = screen.getByAltText("Bulbasaur");
    expect(img).toHaveAttribute("src", spriteUrl);
  });
});

// ---------------------------------------------------------------------------
// Tests - arrival sparkle / suffix (state coverage: seenInPasture in/out)
// ---------------------------------------------------------------------------

describe("PasturePokemon - arrival sparkle", () => {
  it("shows an arrival sparkle and suffixed aria-label when seenInPasture is false", () => {
    const card = makeCard({ state: makeReviewState({ seenInPasture: false }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    // ArrivalSparkle renders as aria-hidden; the button label includes "(new arrival)"
    const btn = screen.getByRole("button", {
      name: /Bulbasaur.*new arrival/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("does not add (new arrival) to the aria-label when seenInPasture is true", () => {
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Bulbasaur" });
    expect(btn).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - locale-resolved names (mandatory coverage: all 4 locales)
// Verifies button aria-label and image alt use the locale-resolved name,
// not the raw English card.name.
// ---------------------------------------------------------------------------

describe("PasturePokemon - locale-resolved name: button aria-label", () => {
  it("uses the English locale name in aria-label (en)", () => {
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();
  });

  it("uses the Japanese locale name in aria-label (ja)", () => {
    mockPokemonLocale = "ja";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["ja"], transliteration: null });
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />, { locale: "ja" });
    expect(screen.getByRole("button", { name: LOCALE_NAMES["ja"] })).toBeInTheDocument();
  });

  it("uses the Simplified Chinese locale name in aria-label (zh-Hans)", () => {
    mockPokemonLocale = "zh-Hans";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hans"], transliteration: null });
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />, { locale: "zh-Hans" });
    expect(screen.getByRole("button", { name: LOCALE_NAMES["zh-Hans"] })).toBeInTheDocument();
  });

  it("uses the Traditional Chinese locale name in aria-label (zh-Hant)", () => {
    mockPokemonLocale = "zh-Hant";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hant"], transliteration: null });
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />, { locale: "zh-Hant" });
    expect(screen.getByRole("button", { name: LOCALE_NAMES["zh-Hant"] })).toBeInTheDocument();
  });
});

describe("PasturePokemon - locale-resolved name: image alt", () => {
  it("uses the English locale name as image alt (en)", () => {
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />);
    expect(screen.getByAltText("Bulbasaur")).toBeInTheDocument();
  });

  it("uses the Japanese locale name as image alt (ja)", () => {
    mockPokemonLocale = "ja";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["ja"], transliteration: null });
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />, { locale: "ja" });
    expect(screen.getByAltText(LOCALE_NAMES["ja"])).toBeInTheDocument();
  });

  it("uses the Simplified Chinese locale name as image alt (zh-Hans)", () => {
    mockPokemonLocale = "zh-Hans";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hans"], transliteration: null });
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />, { locale: "zh-Hans" });
    expect(screen.getByAltText(LOCALE_NAMES["zh-Hans"])).toBeInTheDocument();
  });

  it("uses the Traditional Chinese locale name as image alt (zh-Hant)", () => {
    mockPokemonLocale = "zh-Hant";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hant"], transliteration: null });
    render(<PasturePokemon card={makeCard()} onMarkSeen={vi.fn()} />, { locale: "zh-Hant" });
    expect(screen.getByAltText(LOCALE_NAMES["zh-Hant"])).toBeInTheDocument();
  });
});

describe("PasturePokemon - locale suffix in aria-label with seenInPasture: false", () => {
  it("includes the Japanese new-arrival suffix with the locale name (ja)", () => {
    mockPokemonLocale = "ja";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["ja"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: false }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "ja" });
    // Japanese suffix: "（新着）"
    expect(
      screen.getByRole("button", { name: `${LOCALE_NAMES["ja"]}（新着）` }),
    ).toBeInTheDocument();
  });

  it("includes the Simplified Chinese new-arrival suffix with the locale name (zh-Hans)", () => {
    mockPokemonLocale = "zh-Hans";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hans"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: false }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "zh-Hans" });
    // zh-Hans suffix: "（新到来）"
    expect(
      screen.getByRole("button", { name: `${LOCALE_NAMES["zh-Hans"]}（新到来）` }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - popover locale name (aria-label + visible text + lang attribute)
// ---------------------------------------------------------------------------

describe("PasturePokemon - popover locale names", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openPopover(btn: HTMLElement) {
    await act(async () => {
      fireEvent.pointerDown(btn);
      await vi.advanceTimersByTimeAsync(520);
    });
  }

  it("popover aria-label uses English locale name (en)", async () => {
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Bulbasaur" });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toContain("Bulbasaur");
  });

  it("popover aria-label uses Japanese locale name (ja)", async () => {
    mockPokemonLocale = "ja";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["ja"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "ja" });
    const btn = screen.getByRole("button", { name: LOCALE_NAMES["ja"] });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toContain(LOCALE_NAMES["ja"]);
  });

  it("popover aria-label uses Simplified Chinese locale name (zh-Hans)", async () => {
    mockPokemonLocale = "zh-Hans";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hans"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "zh-Hans" });
    const btn = screen.getByRole("button", { name: LOCALE_NAMES["zh-Hans"] });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toContain(LOCALE_NAMES["zh-Hans"]);
  });

  it("popover aria-label uses Traditional Chinese locale name (zh-Hant)", async () => {
    mockPokemonLocale = "zh-Hant";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["zh-Hant"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "zh-Hant" });
    const btn = screen.getByRole("button", { name: LOCALE_NAMES["zh-Hant"] });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-label")).toContain(LOCALE_NAMES["zh-Hant"]);
  });

  it("popover visible name text uses locale-resolved name (ja)", async () => {
    mockPokemonLocale = "ja";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["ja"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "ja" });
    const btn = screen.getByRole("button", { name: LOCALE_NAMES["ja"] });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(LOCALE_NAMES["ja"]);
  });

  it("wraps visible name in <span lang> for non-English locale (ja)", async () => {
    mockPokemonLocale = "ja";
    mockUseLocalePokemonName.mockReturnValue({ name: LOCALE_NAMES["ja"], transliteration: null });
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />, { locale: "ja" });
    const btn = screen.getByRole("button", { name: LOCALE_NAMES["ja"] });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    const langSpan = dialog?.querySelector("span[lang='ja']");
    expect(langSpan).not.toBeNull();
    expect(langSpan?.textContent).toBe(LOCALE_NAMES["ja"]);
  });

  it("wraps visible name in <span lang='en'> for English locale", async () => {
    const card = makeCard({ state: makeReviewState({ seenInPasture: true }) });
    render(<PasturePokemon card={card} onMarkSeen={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Bulbasaur" });
    await openPopover(btn);
    const dialog = screen.queryByRole("dialog");
    expect(dialog).not.toBeNull();
    const langSpan = dialog?.querySelector("span[lang='en']");
    expect(langSpan).not.toBeNull();
    expect(langSpan?.textContent).toBe("Bulbasaur");
  });
});
