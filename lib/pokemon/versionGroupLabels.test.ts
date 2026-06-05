import { describe, it, expect } from "vitest";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import {
  VERSION_GROUP_LABELS,
  VERSION_GROUP_GENERATION,
  VERSION_GROUP_ORDER,
  versionGroupLabel,
  versionGroupGeneration,
  compareVersionGroupSlugs,
} from "./versionGroupLabels";

describe("versionGroupLabels: completeness", () => {
  it("every version-group slug in SEED_POKEMON has a marketing label", () => {
    const slugsInSeed = new Set<string>();
    for (const p of SEED_POKEMON) {
      const vgs = (p as { versionGroups?: string[] }).versionGroups ?? [];
      for (const vg of vgs) slugsInSeed.add(vg);
    }
    const missing: string[] = [];
    for (const slug of slugsInSeed) {
      if (!(slug in VERSION_GROUP_LABELS)) missing.push(slug);
    }
    expect(missing).toEqual([]);
  });

  it("every version-group slug in SEED_POKEMON has a generation entry", () => {
    const slugsInSeed = new Set<string>();
    for (const p of SEED_POKEMON) {
      const vgs = (p as { versionGroups?: string[] }).versionGroups ?? [];
      for (const vg of vgs) slugsInSeed.add(vg);
    }
    const missing: string[] = [];
    for (const slug of slugsInSeed) {
      if (!(slug in VERSION_GROUP_GENERATION)) missing.push(slug);
    }
    expect(missing).toEqual([]);
  });

  it("VERSION_GROUP_ORDER covers every label key (release-order completeness)", () => {
    const orderSet = new Set(VERSION_GROUP_ORDER);
    const missing = Object.keys(VERSION_GROUP_LABELS).filter((k) => !orderSet.has(k));
    expect(missing).toEqual([]);
  });

  it("no orphan slugs in VERSION_GROUP_ORDER", () => {
    const orphans = VERSION_GROUP_ORDER.filter((s) => !(s in VERSION_GROUP_LABELS));
    expect(orphans).toEqual([]);
  });

  it("every label key is used by at least one species in SEED_POKEMON (no orphan labels)", () => {
    // Collects every version-group slug that actually appears in the seed.
    const slugsInSeed = new Set<string>();
    for (const p of SEED_POKEMON) {
      const vgs = (p as { versionGroups?: string[] }).versionGroups ?? [];
      for (const vg of vgs) slugsInSeed.add(vg);
    }
    // Any key in VERSION_GROUP_LABELS that never appears in the seed is an orphan
    // - it can never be toggled by the game-scope picker and should be removed.
    const orphans = Object.keys(VERSION_GROUP_LABELS).filter((k) => !slugsInSeed.has(k));
    expect(orphans).toEqual([]);
  });
});

describe("versionGroupLabel / versionGroupGeneration", () => {
  it("returns the marketing label for a known slug", () => {
    expect(versionGroupLabel("gold-silver")).toBe("Pokémon Gold/Silver");
  });

  it("falls back to the slug for an unknown entry", () => {
    expect(versionGroupLabel("future-pokemon-game-2099")).toBe("future-pokemon-game-2099");
  });

  it("returns the generation number for a mainline entry", () => {
    expect(versionGroupGeneration("red-blue")).toBe(1);
    expect(versionGroupGeneration("scarlet-violet")).toBe(9);
  });

  it("returns 0 for an unknown entry", () => {
    expect(versionGroupGeneration("future-pokemon-game-2099")).toBe(0);
  });
});

describe("compareVersionGroupSlugs", () => {
  it("sorts earlier generations before later ones", () => {
    expect(compareVersionGroupSlugs("red-blue", "scarlet-violet")).toBeLessThan(0);
    expect(compareVersionGroupSlugs("sword-shield", "gold-silver")).toBeGreaterThan(0);
  });

  it("within a generation uses release order", () => {
    // Both Gen I. red-blue comes after red-green-japan in release order.
    expect(compareVersionGroupSlugs("red-green-japan", "red-blue")).toBeLessThan(0);
    expect(compareVersionGroupSlugs("yellow", "red-blue")).toBeGreaterThan(0);
  });

  it("entries in generation 0 sort first (Other / spin-off bucket)", () => {
    expect(compareVersionGroupSlugs("champions", "red-blue")).toBeLessThan(0);
  });
});
