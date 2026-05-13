import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("@/lib/review/useCardClass", () => ({
  useCardClass: () => "mastered",
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false } }),
}));

// SEED_POKEMON used for evolution sprite lookup — empty array is fine for these tests
vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
}));

vi.mock("@/lib/pokemon/facts", () => ({
  getPokemonFacts: () => [],
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

// ---------------------------------------------------------------------------
// Import the component under test after mocks are set up
// ---------------------------------------------------------------------------

import { PokemonDetailDisclosure } from "@/components/pokedex/PokemonDetailDisclosure";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PokemonDetailDisclosure — audio buttons", () => {
  beforeEach(() => {
    mockSpeakName.mockClear();
    mockPlayCry.mockClear();
  });

  it("main pokemon row renders both TTS and cry buttons with disambiguated aria-labels", () => {
    const pokemon = makePokemon({ displayName: "Bulbasaur", cryUrl: "https://example.com/cries/1.ogg" });
    render(<PokemonDetailDisclosure pokemon={pokemon} />);

    expect(screen.getByRole("button", { name: "Hear Bulbasaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Bulbasaur cry" })).toBeInTheDocument();
  });

  it("main pokemon cry button is omitted when cryUrl is null", () => {
    const pokemon = makePokemon({ cryUrl: null });
    render(<PokemonDetailDisclosure pokemon={pokemon} />);

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
    render(<PokemonDetailDisclosure pokemon={pokemon} forms={[form]} />);

    expect(screen.getByRole("button", { name: "Hear Alolan Raichu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Alolan Raichu cry" })).toBeInTheDocument();
  });

  it("TTS button calls speakName with the pokemon display name", async () => {
    const user = userEvent.setup();
    const pokemon = makePokemon({ displayName: "Bulbasaur" });
    render(<PokemonDetailDisclosure pokemon={pokemon} />);

    await user.click(screen.getByRole("button", { name: "Hear Bulbasaur" }));
    expect(mockSpeakName).toHaveBeenCalledWith("Bulbasaur");
  });

  it("cry button calls playCry with the cryUrl", async () => {
    const user = userEvent.setup();
    const cryUrl = "https://example.com/cries/1.ogg";
    const pokemon = makePokemon({ cryUrl });
    render(<PokemonDetailDisclosure pokemon={pokemon} />);

    await user.click(screen.getByRole("button", { name: "Play Bulbasaur cry" }));
    expect(mockPlayCry).toHaveBeenCalledWith(cryUrl);
  });
});
