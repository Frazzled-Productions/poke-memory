import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mock next/image — renders as a plain img so alt/src/width assertions work
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

// SEED_POKEMON used for evolution sprite lookup — empty array is fine for these tests
vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
}));

vi.mock("@/lib/pokemon/facts", () => ({
  getPokemonFacts: () => [],
  loadFlavorTexts: () => Promise.resolve(new Map()),
}));

// useNextReviewDate — default to "not-started" so it never renders review-date
// copy in unrelated tests.
vi.mock("@/lib/review/useNextReviewDate", () => ({
  useNextReviewDate: () => ({ status: "not-started" }),
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
// Tests — audio buttons
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure — audio buttons", () => {
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
// Tests — Bug #484: alt-form visibility gated on parent being unlocked
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure — alt-form disclosure gating (#484)", () => {
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
// Tests — sprite sizes (#931: shared primitive adoption)
// ---------------------------------------------------------------------------

import {
  POKEDEX_DETAIL_SPRITE_SIZE,
  POKEDEX_FORM_SPRITE_SIZE,
  POKEDEX_NODE_SPRITE_SIZE,
} from "@/lib/sprites/sizes";

describe("PokemonDetailDisclosure — sprite sizes (#931)", () => {
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
// Tests — locked-state signposts (#1440)
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure — locked-state signposts (#1440)", () => {
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
