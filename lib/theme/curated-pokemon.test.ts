import { describe, it, expect } from "vitest";
import { CURATED_POKEMON, BRAND_DEFAULT_COLORS } from "./curated-pokemon";

// ---------------------------------------------------------------------------
// CURATED_POKEMON
// ---------------------------------------------------------------------------

describe("CURATED_POKEMON", () => {
  it("contains at least one entry", () => {
    expect(CURATED_POKEMON.length).toBeGreaterThan(0);
  });

  it("every entry has a positive integer id", () => {
    for (const p of CURATED_POKEMON) {
      expect(Number.isInteger(p.id)).toBe(true);
      expect(p.id).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty name", () => {
    for (const p of CURATED_POKEMON) {
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it("every entry's colors object has all four required fields", () => {
    for (const p of CURATED_POKEMON) {
      expect(typeof p.colors.primary).toBe("string");
      expect(typeof p.colors.secondary).toBe("string");
      expect(typeof p.colors.accent).toBe("string");
      expect(typeof p.colors.fgOnPrimary).toBe("string");
    }
  });

  it("every color field is a non-empty string", () => {
    for (const p of CURATED_POKEMON) {
      for (const key of ["primary", "secondary", "accent", "fgOnPrimary"] as const) {
        expect(p.colors[key].length).toBeGreaterThan(0);
      }
    }
  });

  it("ids are unique within the list", () => {
    const ids = CURATED_POKEMON.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names are unique within the list", () => {
    const names = CURATED_POKEMON.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes Charizard (id: 6)", () => {
    expect(CURATED_POKEMON.some((p) => p.id === 6 && p.name === "Charizard")).toBe(true);
  });

  it("includes Pikachu (id: 25)", () => {
    expect(CURATED_POKEMON.some((p) => p.id === 25 && p.name === "Pikachu")).toBe(true);
  });

  it("includes Eevee (id: 133)", () => {
    expect(CURATED_POKEMON.some((p) => p.id === 133 && p.name === "Eevee")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BRAND_DEFAULT_COLORS
// ---------------------------------------------------------------------------

describe("BRAND_DEFAULT_COLORS", () => {
  it("has all four required color fields", () => {
    expect(typeof BRAND_DEFAULT_COLORS.primary).toBe("string");
    expect(typeof BRAND_DEFAULT_COLORS.secondary).toBe("string");
    expect(typeof BRAND_DEFAULT_COLORS.accent).toBe("string");
    expect(typeof BRAND_DEFAULT_COLORS.fgOnPrimary).toBe("string");
  });

  it("all fields are non-empty strings", () => {
    for (const key of ["primary", "secondary", "accent", "fgOnPrimary"] as const) {
      expect(BRAND_DEFAULT_COLORS[key].length).toBeGreaterThan(0);
    }
  });

  it("primary is the Poké-ball red (#E01B2E)", () => {
    expect(BRAND_DEFAULT_COLORS.primary).toBe("#E01B2E");
  });

  it("fgOnPrimary is white (for contrast on the primary colour)", () => {
    expect(BRAND_DEFAULT_COLORS.fgOnPrimary).toBe("#FFFFFF");
  });
});
