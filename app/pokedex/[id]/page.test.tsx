/**
 * Unit tests for app/pokedex/[id]/page.tsx (#1734 / #1729).
 *
 * Covers generateMetadata - the number-only server-side title function.
 * The page component itself is a Next.js RSC and is integration-tested via e2e;
 * the metadata helper is pure enough to unit-test in the node project.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks - declared before the module under test is imported.
// ---------------------------------------------------------------------------

// next/navigation's notFound is a throw; mock it so the page import doesn't
// crash in the node test environment.
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
}));

// next/link and PokemonDetailDisclosure are JSX - safe to stub since we only
// exercise the non-JSX exports here.
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/components/pokedex/PokemonDetailDisclosure", () => ({
  PokemonDetailDisclosure: () => null,
}));
vi.mock("@/components/ui/PageShell", () => ({
  PageShell: () => null,
}));

// Provide a minimal two-entry seed: one valid species and one alt-form.
vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [
    {
      id: 1,
      speciesId: 1,
      displayName: "Bulbasaur",
      name: "bulbasaur",
      isDefaultForm: true,
      types: ["grass", "poison"],
      spriteUrl: "/sprites/pokemon/1.png",
      evolutionChain: [],
    },
    {
      id: 25,
      speciesId: 25,
      displayName: "Pikachu",
      name: "pikachu",
      isDefaultForm: true,
      types: ["electric"],
      spriteUrl: "/sprites/pokemon/25.png",
      evolutionChain: [],
    },
  ],
}));

// ---------------------------------------------------------------------------
// Import the function under test AFTER mocks are in place.
// ---------------------------------------------------------------------------

import { generateMetadata } from "./page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateMetadata - Pokédex detail page (#1734)", () => {
  it("returns number-only title for a known species", async () => {
    const meta = await generateMetadata(makeParams("1"));
    expect(meta.title).toBe("Pokémon #001 - Pokédex - Poké Memory");
  });

  it("returns number-only title for species 25 (Pikachu)", async () => {
    const meta = await generateMetadata(makeParams("25"));
    expect(meta.title).toBe("Pokémon #025 - Pokédex - Poké Memory");
  });

  it("returns fallback title for an unknown species id", async () => {
    const meta = await generateMetadata(makeParams("9999"));
    expect(meta.title).toBe("Pokédex - Poké Memory");
  });

  it("returns fallback title for a non-numeric id (safety guard)", async () => {
    const meta = await generateMetadata(makeParams("abc"));
    expect(meta.title).toBe("Pokédex - Poké Memory");
  });

  it("includes a description for a known species", async () => {
    const meta = await generateMetadata(makeParams("1"));
    expect(meta.description).toContain("#001");
  });

  it("does NOT include the Pokémon species name in the title (IP posture)", async () => {
    const meta = await generateMetadata(makeParams("25"));
    // Species names must not appear in the server-rendered metadata.
    expect(String(meta.title)).not.toMatch(/Pikachu/i);
    expect(String(meta.title)).not.toMatch(/Bulbasaur/i);
  });
});
