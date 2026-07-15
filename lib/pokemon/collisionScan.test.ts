// Forcing-function test for #1932: scans the REAL built seed for forward
// evolution cards whose rendered trigger phrase collides with a sibling
// branch (same pre-evo, different post-evo, identical prompt). This mirrors
// how the seed is actually assembled at build time (see lib/pokemon/seed.ts),
// so a future PokéAPI re-seed that introduces a new colliding edge fails
// this test with the offending pre-evo and phrase named in the assertion
// message, rather than silently shipping an ambiguous card.
import { describe, expect, it } from "vitest";
import coreData from "@/lib/pokemon/generated-core.json";
import chainsData from "@/lib/pokemon/generated-chains.json";
import { buildSeed } from "@/lib/pokemon/seed-builder";
import type { EvolutionCard } from "@/lib/pokemon/seed-builder";
import { RANDOM_BRANCH_PRE_EVO_IDS } from "@/lib/pokemon/disambiguateTrigger";

const { seedEvolutionCards } = buildSeed(coreData, chainsData);

function groupByPreEvo(): Map<number, EvolutionCard[]> {
  const byPreEvo = new Map<number, EvolutionCard[]>();
  for (const card of seedEvolutionCards) {
    const existing = byPreEvo.get(card.preEvoId);
    if (existing) {
      existing.push(card);
    } else {
      byPreEvo.set(card.preEvoId, [card]);
    }
  }
  return byPreEvo;
}

describe("forward evolution card collision scan", () => {
  it("has no two sibling forward cards rendering the same prompt with different expected answers", () => {
    const byPreEvo = groupByPreEvo();
    const collisions: string[] = [];

    for (const [preEvoId, cards] of byPreEvo) {
      if (RANDOM_BRANCH_PRE_EVO_IDS.has(preEvoId)) continue;

      const phraseToPostEvoIds = new Map<string, Set<number>>();
      for (const card of cards) {
        const key = card.triggerPhrase ?? "";
        const set = phraseToPostEvoIds.get(key) ?? new Set<number>();
        set.add(card.postEvoId);
        phraseToPostEvoIds.set(key, set);
      }

      for (const [phrase, postEvoIds] of phraseToPostEvoIds) {
        if (postEvoIds.size > 1) {
          collisions.push(
            `pre-evo ${preEvoId} (${cards[0]?.preEvoName}): phrase "${phrase}" maps to ${[...postEvoIds].join(", ")}`,
          );
        }
      }
    }

    expect(collisions, collisions.join("\n")).toEqual([]);
  });

  it("Wurmple's forward edges still collide (proves the RANDOM_BRANCH exemption is exercised)", () => {
    const byPreEvo = groupByPreEvo();
    const wurmpleCards = byPreEvo.get(265) ?? [];
    expect(wurmpleCards.length).toBeGreaterThan(1);

    const phrases = new Set(wurmpleCards.map((c) => c.triggerPhrase ?? ""));
    // Both Wurmple branches (Silcoon / Cascoon) render the same phrase - if a
    // future fix disambiguates them, this assertion goes red as a reminder to
    // remove 265 from RANDOM_BRANCH_PRE_EVO_IDS.
    expect(phrases.size).toBe(1);

    const postEvoIds = new Set(wurmpleCards.map((c) => c.postEvoId));
    expect(postEvoIds.size).toBeGreaterThan(1);
  });

  it("Cosmoem, Meowth and Wooper branches now render distinct phrases per postEvo", () => {
    const byPreEvo = groupByPreEvo();

    for (const preEvoId of [790, 52, 194]) {
      const cards = byPreEvo.get(preEvoId) ?? [];
      expect(cards.length).toBeGreaterThan(1);

      const phrases = cards.map((c) => c.triggerPhrase ?? "");
      const distinctPhrases = new Set(phrases);
      expect(
        distinctPhrases.size,
        `pre-evo ${preEvoId} branches should have distinct phrases: ${phrases.join(" | ")}`,
      ).toBe(cards.length);
    }
  });
});
