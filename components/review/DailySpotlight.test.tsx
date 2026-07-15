/**
 * Tests for the "Pokémon of the day" spotlight (#1949) shown on the all-done /
 * zero-card end-of-session screen.
 *
 * Covers:
 * - Empty seed (state "out"): renders nothing while there is no species to show.
 * - Populated seed (state "in"): renders a sprite, a fact, and the reveal control.
 * - The reveal control toggles the hidden name into view.
 * - The Pokémon name renders correctly in en, ja, zh-Hans, and zh-Hant.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { DailySpotlight } from "@/components/review/DailySpotlight";
import enMessages from "@/messages/en.json";
import jaMessages from "@/messages/ja.json";
import zhHansMessages from "@/messages/zh-Hans.json";
import zhHantMessages from "@/messages/zh-Hant.json";
import type { SeedPokemon } from "@/lib/pokemon/seed-builder";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// facts.ts's loadFlavorTexts() fetches a static JSON sidecar - stub fetch so
// it resolves immediately with no flavour entries (non-fatal empty map either
// way, but this avoids an unhandled-rejection warning under jsdom).
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const { mockSeed } = vi.hoisted(() => ({ mockSeed: vi.fn() }));
vi.mock("@/lib/pokemon/SeedContext", () => ({
  useSeed: () => mockSeed(),
}));

// Locale-name resolution: control the active Pokémon-name locale via the
// PokemonLocaleContext mock (mirrors components/i18n/useLocalePokemonName.test.tsx).
let mockContextValue = { locale: "en" as string, languagesEnabled: true, learningLocales: ["en"] };
vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({ ...mockContextValue }),
}));

const mockGetLocaleName = vi.fn<(id: number, locale: string) => string | undefined>();
vi.mock("@/lib/pokemon/localeNames", () => ({
  loadLocaleNames: vi.fn().mockResolvedValue(undefined),
  getLocaleName: (id: number, locale: string) => mockGetLocaleName(id, locale),
  getTransliteration: () => undefined,
}));

function makeBulbasaur(): SeedPokemon {
  return {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
    name: "Bulbasaur",
    spriteUrl: "https://example.com/bulbasaur.png",
    types: ["grass", "poison"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "",
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
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
  } as SeedPokemon;
}

const LOCALE_MESSAGES = {
  en: enMessages,
  ja: jaMessages,
  "zh-Hans": zhHansMessages,
  "zh-Hant": zhHantMessages,
} as const;

function renderSpotlight(locale: keyof typeof LOCALE_MESSAGES = "en") {
  const messages = LOCALE_MESSAGES[locale];
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DailySpotlight timezone="UTC" />
    </NextIntlClientProvider>,
  );
}

describe("DailySpotlight", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    mockContextValue = { locale: "en", languagesEnabled: true, learningLocales: ["en"] };
    mockGetLocaleName.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when the seed has not loaded / is empty (state: out)", () => {
    mockSeed.mockReturnValue({ seed: null });
    const { container } = renderSpotlight();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the seed has no default-form species", () => {
    mockSeed.mockReturnValue({ seed: { seedPokemon: [] } });
    const { container } = renderSpotlight();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a sprite, a fact, and a reveal control when a species is available (state: in)", async () => {
    mockSeed.mockReturnValue({ seed: { seedPokemon: [makeBulbasaur()] } });
    renderSpotlight();

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /reveal the name/i })).toBeInTheDocument();
    // A fact (e.g. Type) should render somewhere on the panel.
    expect(screen.getByText(/pokémon of the day/i)).toBeInTheDocument();
    // Name is hidden until revealed.
    expect(screen.queryByText("Bulbasaur")).not.toBeInTheDocument();
  });

  it("reveals the name when the reveal button is clicked", async () => {
    const user = userEvent.setup();
    mockSeed.mockReturnValue({ seed: { seedPokemon: [makeBulbasaur()] } });
    renderSpotlight();

    const revealBtn = await screen.findByRole("button", { name: /reveal the name/i });
    await user.click(revealBtn);

    expect(await screen.findByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal the name/i })).not.toBeInTheDocument();
  });

  it("renders the localised name and copy in a non-en locale (ja)", async () => {
    const user = userEvent.setup();
    mockContextValue = { locale: "ja", languagesEnabled: true, learningLocales: ["en", "ja"] };
    mockGetLocaleName.mockReturnValue("フシギダネ");
    mockSeed.mockReturnValue({ seed: { seedPokemon: [makeBulbasaur()] } });
    renderSpotlight("ja");

    // ja copy for the heading.
    expect(await screen.findByText("今日のポケモン")).toBeInTheDocument();

    const revealBtn = screen.getByRole("button", { name: "名前を表示" });
    await user.click(revealBtn);

    expect(await screen.findByText("フシギダネ")).toBeInTheDocument();
  });

  it("renders the localised name and copy in a non-en locale (zh-Hans)", async () => {
    const user = userEvent.setup();
    mockContextValue = { locale: "zh-Hans", languagesEnabled: true, learningLocales: ["en", "zh-Hans"] };
    mockGetLocaleName.mockReturnValue("妙蛙种子");
    mockSeed.mockReturnValue({ seed: { seedPokemon: [makeBulbasaur()] } });
    renderSpotlight("zh-Hans");

    // zh-Hans copy for the heading.
    expect(await screen.findByText("今日宝可梦")).toBeInTheDocument();

    const revealBtn = screen.getByRole("button", { name: "揭晓名字" });
    await user.click(revealBtn);

    expect(await screen.findByText("妙蛙种子")).toBeInTheDocument();
  });

  it("renders the localised name and copy in a non-en locale (zh-Hant)", async () => {
    const user = userEvent.setup();
    mockContextValue = { locale: "zh-Hant", languagesEnabled: true, learningLocales: ["en", "zh-Hant"] };
    mockGetLocaleName.mockReturnValue("妙蛙種子");
    mockSeed.mockReturnValue({ seed: { seedPokemon: [makeBulbasaur()] } });
    renderSpotlight("zh-Hant");

    // zh-Hant copy for the heading.
    expect(await screen.findByText("今日寶可夢")).toBeInTheDocument();

    const revealBtn = screen.getByRole("button", { name: "揭曉名字" });
    await user.click(revealBtn);

    expect(await screen.findByText("妙蛙種子")).toBeInTheDocument();
  });
});
