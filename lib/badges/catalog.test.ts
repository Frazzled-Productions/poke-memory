import { describe, it, expect } from "vitest";
import { BADGE_CATALOG } from "./catalog";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

describe("BADGE_CATALOG", () => {
  it("has unique badge ids — re-using an id would re-award an existing badge", () => {
    const ids = BADGE_CATALOG.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses kebab-case ids", () => {
    for (const badge of BADGE_CATALOG) {
      expect(badge.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("references only species ids present in the seed (no typos)", () => {
    const seedIds = new Set(SEED_POKEMON.map((p) => p.id));
    for (const badge of BADGE_CATALOG) {
      for (const speciesId of badge.criterion.speciesIds) {
        expect(seedIds.has(speciesId)).toBe(true);
      }
    }
  });

  it("every criterion lists at least one species", () => {
    for (const badge of BADGE_CATALOG) {
      expect(badge.criterion.speciesIds.length).toBeGreaterThan(0);
    }
  });
});
