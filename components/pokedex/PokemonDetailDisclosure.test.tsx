import { screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mock next/image - renders as a plain img so alt/src/width assertions work
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Mocks for audio modules
// ---------------------------------------------------------------------------

const { mockSpeakName, mockPlayCry } = vi.hoisted(() => ({
  mockSpeakName: vi.fn(),
  mockPlayCry: vi.fn(),
}));

vi.mock("@/lib/audio/tts", () => ({ speakName: mockSpeakName }));
vi.mock("@/lib/audio/cry", () => ({ playCry: mockPlayCry }));

// ---------------------------------------------------------------------------
// Mocks for hooks PokemonDetailDisclosure depends on
// ---------------------------------------------------------------------------

const { mockCardClass, mockPretendAllMastered } = vi.hoisted(() => ({
  mockCardClass: { value: "mastered" as string },
  mockPretendAllMastered: { value: false },
}));

vi.mock("@/lib/review/useCardClass", () => ({
  useCardClass: () => mockCardClass.value,
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: mockPretendAllMastered.value } }),
}));

// SEED_POKEMON used for evolution sprite lookup - empty array is fine for these tests
vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
}));

// Default mock returns no facts; individual tests override via mockGetPokemonFacts.
// mockLoadFlavorTexts lets tests control when the async fetch resolves so we can
// verify the component re-renders once the promise settles.
const {
  mockGetPokemonFacts,
  mockIsFlavorTextsReady,
  mockLoadFlavorTexts,
} = vi.hoisted(() => ({
  mockGetPokemonFacts: vi.fn(() => [] as import("@/lib/pokemon/facts").PokemonFact[]),
  mockIsFlavorTextsReady: vi.fn(() => false),
  mockLoadFlavorTexts: vi.fn(() => Promise.resolve(new Map<number, import("@/lib/pokemon/seed").FlavorTextEntry[]>())),
}));

vi.mock("@/lib/pokemon/facts", () => ({
  getPokemonFacts: (...args: Parameters<typeof mockGetPokemonFacts>) => mockGetPokemonFacts(...args),
  isFlavorTextsReady: () => mockIsFlavorTextsReady(),
  loadFlavorTexts: () => mockLoadFlavorTexts(),
}));

// useNextReviewDate - default to "not-started" so it never renders review-date
// copy in unrelated tests.
vi.mock("@/lib/review/useNextReviewDate", () => ({
  useNextReviewDate: () => ({ status: "not-started" }),
}));

// useSpeciesLegStatus internals (#1766): loadSession provides the cards;
// computeSpeciesLegStatuses is stubbed so tests control the per-leg status
// without constructing full card fixtures (the derivation itself is covered
// in lib/stats/legStatus.test.ts).
const { mockLoadSession, mockLegStatusMap } = vi.hoisted(() => ({
  // Default: resolve null so the useSpeciesLegStatus hook no-ops in every
  // existing test that renders the component (only the #1766 tests below
  // opt into a populated session).
  mockLoadSession: vi.fn(
    (): Promise<{ cards: unknown[] } | null> => Promise.resolve(null),
  ),
  mockLegStatusMap: {
    value: new Map<number, import("@/lib/stats/legStatus").SpeciesLegStatus>(),
  },
}));
vi.mock("@/lib/review/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/review/persistence")>()),
  loadSession: (() =>
    mockLoadSession()) as typeof import("@/lib/review/persistence").loadSession,
}));
vi.mock("@/lib/stats/legStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stats/legStatus")>()),
  computeSpeciesLegStatuses: (() =>
    mockLegStatusMap.value) as typeof import("@/lib/stats/legStatus").computeSpeciesLegStatuses,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { SeedPokemon } from "@/lib/pokemon/seed";

function makePokemon(overrides: Partial<SeedPokemon> = {}): SeedPokemon {
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
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
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
    cryUrl: "https://example.com/cries/1.ogg",
    ...overrides,
  };
}

function makeAltForm(overrides: Partial<SeedPokemon> = {}): SeedPokemon {
  return makePokemon({
    id: 10100,
    speciesId: 37,
    isDefaultForm: false,
    formCategory: "regional",
    formSlug: "alola",
    displayName: "Alolan Vulpix",
    name: "vulpix-alola",
    cryUrl: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Import the component under test after mocks are set up
// ---------------------------------------------------------------------------

import { PokemonDetailDisclosure } from "@/components/pokedex/PokemonDetailDisclosure";

// ---------------------------------------------------------------------------
// Tests - audio buttons
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure - audio buttons", () => {
  beforeEach(() => {
    mockSpeakName.mockClear();
    mockPlayCry.mockClear();
    mockCardClass.value = "mastered";
    mockPretendAllMastered.value = false;
  });

  it("main pokemon row renders both TTS and cry buttons with disambiguated aria-labels", () => {
    const pokemon = makePokemon({ displayName: "Bulbasaur", cryUrl: "https://example.com/cries/1.ogg" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("button", { name: "Hear Bulbasaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Bulbasaur cry" })).toBeInTheDocument();
  });

  it("main pokemon cry button is omitted when cryUrl is null", () => {
    const pokemon = makePokemon({ cryUrl: null });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("button", { name: "Hear Bulbasaur" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play Bulbasaur cry" })).not.toBeInTheDocument();
  });

  it("alt-form row renders both TTS and cry buttons", () => {
    const pokemon = makePokemon({ cryUrl: null });
    const form = makePokemon({
      id: 10100,
      speciesId: 26,
      isDefaultForm: false,
      formCategory: "regional",
      formSlug: "alola",
      displayName: "Alolan Raichu",
      name: "raichu-alola",
      cryUrl: "https://example.com/cries/raichu-alola.ogg",
    });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    expect(screen.getByRole("button", { name: "Hear Alolan Raichu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Alolan Raichu cry" })).toBeInTheDocument();
  });

  it("TTS button calls speakName with the pokemon display name", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ displayName: "Bulbasaur" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    await user.click(screen.getByRole("button", { name: "Hear Bulbasaur" }));
    expect(mockSpeakName).toHaveBeenCalledWith("Bulbasaur", 1);
  });

  it("cry button calls playCry with the cryUrl", async () => {
    const user = userEvent.setup();
    const cryUrl = "https://example.com/cries/1.ogg";
    const pokemon = makePokemon({ cryUrl });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    await user.click(screen.getByRole("button", { name: "Play Bulbasaur cry" }));
    expect(mockPlayCry).toHaveBeenCalledWith(cryUrl);
  });
});

// ---------------------------------------------------------------------------
// Tests - Bug #484: alt-form visibility gated on parent being unlocked
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure - alt-form disclosure gating (#484)", () => {
  beforeEach(() => {
    mockSpeakName.mockClear();
    mockPlayCry.mockClear();
    mockPretendAllMastered.value = false;
  });

  it("locked species: Forms section is NOT rendered", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 37, speciesId: 37, displayName: "Vulpix", name: "Vulpix" });
    const form = makeAltForm();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    expect(screen.queryByRole("heading", { name: "Forms", level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText("Alolan Vulpix")).not.toBeInTheDocument();
  });

  it("locked species + pretendAllMastered on: Forms section IS rendered", () => {
    // pretendAllMastered overrides the locked state in the component
    mockCardClass.value = "locked";
    mockPretendAllMastered.value = true;
    const pokemon = makePokemon({ id: 37, speciesId: 37, displayName: "Vulpix", name: "Vulpix" });
    const form = makeAltForm();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    expect(screen.getByRole("heading", { name: "Forms", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Alolan Vulpix")).toBeInTheDocument();
  });

  it("unlocked (learning) species: Forms section IS rendered", () => {
    mockCardClass.value = "learning";
    const pokemon = makePokemon({ id: 37, speciesId: 37, displayName: "Vulpix", name: "Vulpix" });
    const form = makeAltForm();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    expect(screen.getByRole("heading", { name: "Forms", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Alolan Vulpix")).toBeInTheDocument();
  });

  it("unlocked (mastered) species: Forms section IS rendered", () => {
    mockCardClass.value = "mastered";
    const pokemon = makePokemon({ id: 37, speciesId: 37, displayName: "Vulpix", name: "Vulpix" });
    const form = makeAltForm();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    expect(screen.getByRole("heading", { name: "Forms", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Alolan Vulpix")).toBeInTheDocument();
  });

  it("dropdown excludes current form when current pokemon is an alt form", () => {
    // This simulates a hypothetical alt-form page: the current pokemon IS an
    // alt form (Alolan Vulpix), so forms list should NOT include it.
    // The page-level filter handles this; here we verify the component only
    // renders the forms it is given (sibling forms, not self).
    mockCardClass.value = "learning";
    const alolanVulpix = makeAltForm({ displayName: "Alolan Vulpix" });
    // The page would filter out Alolan Vulpix from forms; only sibling forms passed.
    const siblingForm = makeAltForm({
      id: 10200,
      displayName: "Some Other Form",
      formSlug: "other",
    });
    renderWithIntl(<PokemonDetailDisclosure pokemon={alolanVulpix} forms={[siblingForm]} />);

    expect(screen.getByText("Some Other Form")).toBeInTheDocument();
    // The current form (Alolan Vulpix as primary pokemon name) appears in heading
    // but NOT as a FormBlock item
    const formHeadings = screen.queryAllByText("Alolan Vulpix");
    // Only the main header h1 contains the name, not a FormBlock summary
    // The FormBlock would render it as an img alt + summary text
    const formsSection = screen.getByRole("heading", { name: "Forms", level: 2 });
    expect(formsSection).toBeInTheDocument();
    // No FormBlock for Alolan Vulpix itself
    const summaries = screen.queryAllByText("Alolan Vulpix");
    // The only "Alolan Vulpix" text should be from the main h1, not inside a FormBlock
    // We check it's at most 1 occurrence (the main heading)
    expect(formHeadings.length).toBeLessThanOrEqual(1);
    expect(summaries.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests - sprite sizes (#931: shared primitive adoption)
// ---------------------------------------------------------------------------

import {
  POKEDEX_DETAIL_SPRITE_SIZE,
  POKEDEX_FORM_SPRITE_SIZE,
  POKEDEX_NODE_SPRITE_SIZE,
} from "@/lib/sprites/sizes";

describe("PokemonDetailDisclosure - sprite sizes (#931)", () => {
  beforeEach(() => {
    mockCardClass.value = "mastered";
    mockPretendAllMastered.value = false;
  });

  it("main sprite renders at POKEDEX_DETAIL_SPRITE_SIZE", () => {
    const pokemon = makePokemon({ spriteUrl: "/sprites/pokemon/1.png" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    const img = screen.getByRole("img", { name: "Bulbasaur" });
    expect(img).toHaveAttribute("width", String(POKEDEX_DETAIL_SPRITE_SIZE));
    expect(img).toHaveAttribute("height", String(POKEDEX_DETAIL_SPRITE_SIZE));
  });

  it("alt-form thumbnail in FormBlock renders at POKEDEX_NODE_SPRITE_SIZE", () => {
    const pokemon = makePokemon({ cryUrl: null });
    const form = makeAltForm({ displayName: "Alolan Raichu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    // The thumbnail img inside the FormBlock summary is the one that comes
    // before the span text; query by alt to target it specifically.
    const thumbnails = screen.getAllByRole("img", { name: "Alolan Raichu" });
    // Two images: the summary thumbnail and the full-size sprite inside the
    // expanded block. Both should exist; check the thumbnail (smaller width).
    const thumbnail = thumbnails.find(
      (el) => el.getAttribute("width") === String(POKEDEX_NODE_SPRITE_SIZE),
    );
    expect(thumbnail).toBeTruthy();
    expect(thumbnail).toHaveAttribute("height", String(POKEDEX_NODE_SPRITE_SIZE));
  });

  it("alt-form full sprite in FormBlock renders at POKEDEX_FORM_SPRITE_SIZE", () => {
    const pokemon = makePokemon({ cryUrl: null });
    const form = makeAltForm({ displayName: "Alolan Raichu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    const fullSprite = screen.getAllByRole("img", { name: "Alolan Raichu" }).find(
      (el) => el.getAttribute("width") === String(POKEDEX_FORM_SPRITE_SIZE),
    );
    expect(fullSprite).toBeTruthy();
    expect(fullSprite).toHaveAttribute("height", String(POKEDEX_FORM_SPRITE_SIZE));
  });
});

// ---------------------------------------------------------------------------
// Tests - locked-state signposts (#1440)
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure - locked-state signposts (#1440)", () => {
  beforeEach(() => {
    mockSpeakName.mockClear();
    mockPlayCry.mockClear();
    mockPretendAllMastered.value = false;
  });

  // ── Base Stats section ────────────────────────────────────────────────────

  it("locked: Base Stats section shows unlock hint, not stat bars", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Base Stats", level: 2 })).toBeInTheDocument();
// Both Base Stats and Facts sections show the same hint (two occurrences)
    const hints = screen.getAllByText("Unlocks when you master this Pokémon.");
    expect(hints.length).toBeGreaterThanOrEqual(1);
    // Stat bar list should NOT be present
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
  });

  it("mastered: Base Stats section shows stat bars, not unlock hint", () => {
    mockCardClass.value = "mastered";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Base Stats", level: 2 })).toBeInTheDocument();
    // Stat labels rendered
    expect(screen.getByText("HP")).toBeInTheDocument();
    expect(screen.getByText("Speed")).toBeInTheDocument();
    // Unlock hint should NOT appear for mastered
    expect(screen.queryByText("Unlocks when you master this Pokémon.")).not.toBeInTheDocument();
  });

  it("learning (not mastered, not locked): Base Stats section is hidden", () => {
    mockCardClass.value = "learning";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    // learning state shows no stats section at all (neither mastered nor locked branch)
    expect(screen.queryByRole("heading", { name: "Base Stats", level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText("Unlocks when you master this Pokémon.")).not.toBeInTheDocument();
  });

  it("locked + pretendAllMastered on: stat bars shown, no locked hint", () => {
    mockCardClass.value = "locked";
    mockPretendAllMastered.value = true;
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Base Stats", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("HP")).toBeInTheDocument();
    // No locked signpost
    expect(screen.queryByText("Unlocks when you master this Pokémon.")).not.toBeInTheDocument();
  });

  // ── Facts section ─────────────────────────────────────────────────────────

  it("locked: Facts section shows unlock hint", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Facts", level: 2 })).toBeInTheDocument();
    // Two occurrences of the hint: one for Base Stats, one for Facts
    const hints = screen.getAllByText("Unlocks when you master this Pokémon.");
    expect(hints.length).toBeGreaterThanOrEqual(2);
  });

  it("mastered: Facts section is rendered without unlock hint", () => {
    mockCardClass.value = "mastered";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Facts", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Unlocks when you master this Pokémon.")).not.toBeInTheDocument();
  });

  // ── Evolution Chain section ───────────────────────────────────────────────

  function makePokemonWithEvolution(): ReturnType<typeof makePokemon> {
    return makePokemon({
      evolutionChain: [
        { speciesId: 1, name: "Bulbasaur", evolvesFromId: null },
        { speciesId: 2, name: "Ivysaur", evolvesFromId: 1 },
      ],
    });
  }

  it("locked with multi-stage evo: Evolution Chain section shows unlock hint", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemonWithEvolution();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Evolution Chain", level: 2 })).toBeInTheDocument();
    const hints = screen.getAllByText("Unlocks when you master this Pokémon.");
    expect(hints.length).toBeGreaterThanOrEqual(1);
  });

  it("mastered with multi-stage evo: Evolution Chain section shows chain", () => {
    mockCardClass.value = "mastered";
    const pokemon = makePokemonWithEvolution();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("heading", { name: "Evolution Chain", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Unlocks when you master this Pokémon.")).not.toBeInTheDocument();
  });

  // ── Locale coverage ───────────────────────────────────────────────────────

  it("locked: Base Stats hint renders in Japanese", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />, { locale: "ja" });

    const hints = screen.getAllByText("この Pokémon を習得すると解放されます。");
    expect(hints.length).toBeGreaterThanOrEqual(1);
  });

  it("locked: Base Stats hint renders in Simplified Chinese", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />, { locale: "zh-Hans" });

    const hints = screen.getAllByText("掌握这只宝可梦后解锁。");
    expect(hints.length).toBeGreaterThanOrEqual(1);
  });

  it("locked: Base Stats hint renders in Traditional Chinese", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon();
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />, { locale: "zh-Hant" });

    const hints = screen.getAllByText("掌握這隻寶可夢後解鎖。");
    expect(hints.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests - game-label facts (#1559)
// Verifies that FlavorTextEntry facts render with game names instead of the
// generic "Pokédex entry" label, and that game names stay English across all
// four supported locales (English proper nouns are locale-invariant by design).
// ---------------------------------------------------------------------------

import type { PokemonFact } from "@/lib/pokemon/facts";

describe("PokemonDetailDisclosure - game-label facts (#1559)", () => {
  beforeEach(() => {
    mockCardClass.value = "mastered";
    mockPretendAllMastered.value = false;
    mockGetPokemonFacts.mockReset();
  });

  // Helper: stub getPokemonFacts with one Pokédex-entry fact
  function withGameFact(label: string, value: string): PokemonFact[] {
    return [{ label, value }];
  }

  it("en locale: renders game-label 'Red · Blue' instead of 'Pokédex entry'", () => {
    mockGetPokemonFacts.mockReturnValue(withGameFact("Red · Blue", "Its short feet are tipped..."));
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "en" });
    expect(screen.getByText("Red · Blue")).toBeInTheDocument();
    expect(screen.queryByText("Pokédex entry")).not.toBeInTheDocument();
  });

  it("ja locale: game label stays English ('Red · Blue'), not translated", () => {
    mockGetPokemonFacts.mockReturnValue(withGameFact("Red · Blue", "Its short feet are tipped..."));
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "ja" });
    expect(screen.getByText("Red · Blue")).toBeInTheDocument();
  });

  it("zh-Hans locale: game label stays English ('FireRed · LeafGreen'), not translated", () => {
    mockGetPokemonFacts.mockReturnValue(withGameFact("FireRed · LeafGreen", "Burrow text."));
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "zh-Hans" });
    expect(screen.getByText("FireRed · LeafGreen")).toBeInTheDocument();
  });

  it("zh-Hant locale: game label stays English ('Scarlet · Violet'), not translated", () => {
    mockGetPokemonFacts.mockReturnValue(withGameFact("Scarlet · Violet", "Another text."));
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "zh-Hant" });
    expect(screen.getByText("Scarlet · Violet")).toBeInTheDocument();
  });

  it("overflow label '+N' is rendered when many games share a text", () => {
    mockGetPokemonFacts.mockReturnValue(withGameFact("Red · Blue · Yellow +2", "Old text."));
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "en" });
    expect(screen.getByText("Red · Blue · Yellow +2")).toBeInTheDocument();
  });

  it("empty flavour section: panel renders without Pokédex-entry rows (absent-flavour fallback)", () => {
    mockGetPokemonFacts.mockReturnValue([]);
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "en" });
    // Facts section renders with heading but no flavour rows
    expect(screen.getByRole("heading", { name: "Facts", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Pokédex entry")).not.toBeInTheDocument();
    expect(screen.queryByText(/Red · Blue/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - re-render after async flavour load (#1559 regression guard)
// Verifies that game labels appear after loadFlavorTexts resolves even on a
// cold first visit where the module-level cache is empty on initial render.
// Without the `flavorLoaded` state wiring the component has no re-render
// trigger and game labels are silently absent.
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure - async flavour re-render (#1559)", () => {
  beforeEach(() => {
    mockCardClass.value = "mastered";
    mockPretendAllMastered.value = false;
    mockIsFlavorTextsReady.mockReset();
    mockIsFlavorTextsReady.mockReturnValue(false);
    mockLoadFlavorTexts.mockReset();
    mockLoadFlavorTexts.mockReturnValue(Promise.resolve(new Map()));
    mockGetPokemonFacts.mockReset();
  });

  it("game-label row is absent before loadFlavorTexts resolves and present after", async () => {
    // Simulate a deferred fetch: hold the promise open, then resolve it manually.
    let resolveLoad!: () => void;
    const deferred = new Promise<Map<number, import("@/lib/pokemon/seed").FlavorTextEntry[]>>(
      (resolve) => {
        resolveLoad = () => resolve(new Map());
      },
    );
    mockLoadFlavorTexts.mockReturnValue(deferred);

    // Before resolve: getPokemonFacts returns no rows (cache empty).
    mockGetPokemonFacts.mockReturnValue([]);
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "en" });

    // The Facts heading is present (mastered state) but no game-label row yet.
    expect(screen.getByRole("heading", { name: "Facts", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Red · Blue · LeafGreen")).not.toBeInTheDocument();

    // After resolve: getPokemonFacts now returns a game-label row (cache populated).
    mockGetPokemonFacts.mockReturnValue([
      { label: "Red · Blue · LeafGreen", value: "A strange seed was planted on its back at birth." },
    ]);
    await act(async () => {
      resolveLoad();
      await deferred;
    });

    // The component must have re-rendered and the game-label row is now visible.
    expect(screen.getByText("Red · Blue · LeafGreen")).toBeInTheDocument();
  });

  it("when cache is already warm (isFlavorTextsReady=true), no deferred render needed", () => {
    // Cache already populated - component should render game labels immediately.
    mockIsFlavorTextsReady.mockReturnValue(true);
    mockLoadFlavorTexts.mockReturnValue(Promise.resolve(new Map()));
    mockGetPokemonFacts.mockReturnValue([
      { label: "Red · Blue", value: "A strange seed was planted on its back at birth." },
    ]);
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "en" });

    expect(screen.getByText("Red · Blue")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - locked h1 and document.title (#1734 / #1729)
// Verifies the locked species shows #{zeroPad(id)} as the visible h1 text
// with an aria-label, and the unlocked species shows the localised name.
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure - locked h1 (#1734)", () => {
  beforeEach(() => {
    mockSpeakName.mockClear();
    mockPlayCry.mockClear();
    mockPretendAllMastered.value = false;
  });

  it("locked: h1 shows #{zeroPad(id)} as the visible text (not ???)", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 25, speciesId: 25, displayName: "Pikachu", name: "pikachu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toBeInTheDocument();
    // Visible text must be the zero-padded dex number, not "???"
    expect(h1.textContent).toBe("#025");
    expect(h1.textContent).not.toBe("???");
  });

  it("locked: h1 has aria-label '#025 (locked)' to prevent digit-by-digit reading", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 25, speciesId: 25, displayName: "Pikachu", name: "pikachu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    const h1 = screen.getByRole("heading", { level: 1 });
    // en catalogue: pokedex.lockedAriaLabel = "#{number} (locked)"
    expect(h1).toHaveAttribute("aria-label", "#025 (locked)");
  });

  it("locked: h1 has muted styling (zinc-300 / zinc-700)", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 1, speciesId: 1, displayName: "Bulbasaur", name: "bulbasaur" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toMatch(/zinc-300|zinc-700/);
  });

  it("unlocked (mastered): h1 shows the localised Pokémon name, not the dex number", () => {
    mockCardClass.value = "mastered";
    const pokemon = makePokemon({ id: 1, speciesId: 1, displayName: "Bulbasaur", name: "Bulbasaur" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Bulbasaur");
    expect(h1.textContent).not.toContain("#");
  });

  it("unlocked (learning): h1 shows the Pokémon name, not the dex number", () => {
    mockCardClass.value = "learning";
    const pokemon = makePokemon({ id: 1, speciesId: 1, displayName: "Bulbasaur", name: "Bulbasaur" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Bulbasaur");
  });

  // ── Locale matrix for locked aria-label (#1729 concern) ──────────────────
  // The lockedAriaLabel key is translated in all four supported locales;
  // verify each emits the correct localised aria-label on the h1.

  it("locked: h1 aria-label is localised in Japanese", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 25, speciesId: 25, displayName: "Pikachu", name: "pikachu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />, { locale: "ja" });

    const h1 = screen.getByRole("heading", { level: 1 });
    // ja catalogue: pokedex.lockedAriaLabel = "#{number}（ロック中）"
    expect(h1).toHaveAttribute("aria-label", "#025（ロック中）");
  });

  it("locked: h1 aria-label is localised in Simplified Chinese", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 25, speciesId: 25, displayName: "Pikachu", name: "pikachu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />, { locale: "zh-Hans" });

    const h1 = screen.getByRole("heading", { level: 1 });
    // zh-Hans catalogue: pokedex.lockedAriaLabel = "#{number}（已锁定）"
    expect(h1).toHaveAttribute("aria-label", "#025（已锁定）");
  });

  it("locked: h1 aria-label is localised in Traditional Chinese", () => {
    mockCardClass.value = "locked";
    const pokemon = makePokemon({ id: 25, speciesId: 25, displayName: "Pikachu", name: "pikachu" });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />, { locale: "zh-Hant" });

    const h1 = screen.getByRole("heading", { level: 1 });
    // zh-Hant catalogue: pokedex.lockedAriaLabel = "#{number}（已鎖定）"
    expect(h1).toHaveAttribute("aria-label", "#025（已鎖定）");
  });
});

// ---------------------------------------------------------------------------
// Tests - per-direction leg status section (#1766)
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure - per-direction leg status (#1766)", () => {
  const blockedStatus = {
    speciesId: 1,
    name: "mastered",
    reverse: "learning",
    isBlocked: true,
    blockingLeg: "reverse",
  } as const;

  beforeEach(() => {
    mockCardClass.value = "mastered";
    mockPretendAllMastered.value = false;
    mockLoadSession.mockResolvedValue({ cards: [] });
    mockLegStatusMap.value = new Map();
  });

  it("renders name + reverse leg status and the blocked-on hint (en)", async () => {
    mockLegStatusMap.value = new Map([[1, blockedStatus]]);
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />);
    expect(await screen.findByText("Blocked on reverse card")).toBeInTheDocument();
    expect(screen.getByText("Name card")).toBeInTheDocument();
    expect(screen.getByText("Reverse card")).toBeInTheDocument();
    expect(screen.getByText("Mastered")).toBeInTheDocument();
    expect(screen.getByText("Learning")).toBeInTheDocument();
  });

  it("renders leg-status labels in Japanese (ja)", async () => {
    mockLegStatusMap.value = new Map([[1, blockedStatus]]);
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />, { locale: "ja" });
    expect(await screen.findByText("名前カード")).toBeInTheDocument();
    expect(screen.getByText("逆引きカード")).toBeInTheDocument();
  });

  it("suppresses the section when pretendAllMastered is on", async () => {
    mockPretendAllMastered.value = true;
    mockLegStatusMap.value = new Map([[1, blockedStatus]]);
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Name card")).not.toBeInTheDocument();
  });

  it("suppresses the section when no leg status is available", async () => {
    mockLegStatusMap.value = new Map();
    renderWithIntl(<PokemonDetailDisclosure pokemon={makePokemon()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Name card")).not.toBeInTheDocument();
  });
});
