import { describe, expect, it } from "vitest";
import {
  disambiguateTriggerPhrase,
  RANDOM_BRANCH_PRE_EVO_IDS,
} from "@/lib/pokemon/disambiguateTrigger";

describe("disambiguateTriggerPhrase", () => {
  it("appends the Sun/Ultra Sun clause for Cosmoem -> Solgaleo", () => {
    expect(disambiguateTriggerPhrase(790, 791, "at level 53")).toBe(
      "at level 53 in Pokémon Sun / Ultra Sun",
    );
  });

  it("appends the Moon/Ultra Moon clause for Cosmoem -> Lunala", () => {
    expect(disambiguateTriggerPhrase(790, 792, "at level 53")).toBe(
      "at level 53 in Pokémon Moon / Ultra Moon",
    );
  });

  it("appends the Galarian Meowth clause for Meowth -> Perrserker", () => {
    expect(disambiguateTriggerPhrase(52, 863, "at level 28")).toBe(
      "at level 28 while it's a Galarian Meowth",
    );
  });

  it("appends the Paldean Wooper clause for Wooper -> Clodsire", () => {
    expect(disambiguateTriggerPhrase(194, 980, "at level 20")).toBe(
      "at level 20 while it's a Paldean Wooper",
    );
  });

  it("passes the base phrase through unchanged for the default Meowth branch", () => {
    expect(disambiguateTriggerPhrase(52, 53, "at level 28")).toBe(
      "at level 28",
    );
  });

  it("passes the base phrase through unchanged for the default Wooper branch", () => {
    expect(disambiguateTriggerPhrase(194, 195, "at level 20")).toBe(
      "at level 20",
    );
  });

  it("passes the base phrase through unchanged for Wurmple's edges (random branch)", () => {
    expect(disambiguateTriggerPhrase(265, 266, "at level 7")).toBe(
      "at level 7",
    );
    expect(disambiguateTriggerPhrase(265, 268, "at level 7")).toBe(
      "at level 7",
    );
  });

  it("passes an unrelated edge's phrase through unchanged", () => {
    expect(disambiguateTriggerPhrase(1, 2, "at level 16")).toBe(
      "at level 16",
    );
  });

  it("defensively trims a leading space when base is null", () => {
    expect(disambiguateTriggerPhrase(790, 791, null)).toBe(
      "in Pokémon Sun / Ultra Sun",
    );
  });

  it("defensively trims a leading space when base is an empty string", () => {
    expect(disambiguateTriggerPhrase(52, 863, "")).toBe(
      "while it's a Galarian Meowth",
    );
  });

  it("exports Wurmple in RANDOM_BRANCH_PRE_EVO_IDS", () => {
    expect(RANDOM_BRANCH_PRE_EVO_IDS.has(265)).toBe(true);
  });
});
