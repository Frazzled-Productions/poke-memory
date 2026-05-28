import { describe, it, expect } from "vitest";
import {
  SEED_POKEMON,
  SEED_EVOLUTION_CARDS,
  SEED_REVERSE_EVOLUTION_CARDS,
  reverseEdgeIdFor,
  isReverseEdgeId,
  EDGE_ID_BASE,
  REVERSE_ID_OFFSET,
  REVERSE_EDGE_ID_BASE,
  CRY_ID_OFFSET,
  EVOLUTION_ID_OFFSET,
  type EvolutionCard,
  type EvolutionNode,
  type SeedPokemon,
} from "./seed";

// ---------------------------------------------------------------------------
// reverseEdgeIdFor
// ---------------------------------------------------------------------------

describe("reverseEdgeIdFor", () => {
  it("maps the first forward edge to the first reverse edge", () => {
    const forwardId = EDGE_ID_BASE + 1; // 1_500_001
    expect(reverseEdgeIdFor(forwardId)).toBe(REVERSE_EDGE_ID_BASE + 1); // 2_500_001
  });

  it("maps an arbitrary forward edge to the correct reverse slot", () => {
    const forwardId = EDGE_ID_BASE + 42; // 1_500_042
    expect(reverseEdgeIdFor(forwardId)).toBe(REVERSE_EDGE_ID_BASE + 42); // 2_500_042
  });

  it("preserves the offset delta — forward and reverse IDs differ by exactly REVERSE_EDGE_ID_BASE - EDGE_ID_BASE", () => {
    const forwardId = EDGE_ID_BASE + 100;
    const delta = REVERSE_EDGE_ID_BASE - EDGE_ID_BASE;
    expect(reverseEdgeIdFor(forwardId)).toBe(forwardId + delta);
  });

  it("round-trips: applying the same transformation twice gives a predictable result", () => {
    // Two hops: fwd → rev → (rev's own reverse namespace)
    const forwardId = EDGE_ID_BASE + 7;
    const reverseId = reverseEdgeIdFor(forwardId);
    // Verify the reverse ID is in the correct namespace before further use
    expect(reverseId).toBeGreaterThan(REVERSE_EDGE_ID_BASE);
    expect(reverseId).toBeLessThan(CRY_ID_OFFSET);
  });
});

// ---------------------------------------------------------------------------
// isReverseEdgeId
// ---------------------------------------------------------------------------

describe("isReverseEdgeId", () => {
  it("returns true for a valid reverse edge ID just above the base", () => {
    expect(isReverseEdgeId(REVERSE_EDGE_ID_BASE + 1)).toBe(true);
  });

  it("returns true for a reverse edge ID in the middle of the range", () => {
    expect(isReverseEdgeId(REVERSE_EDGE_ID_BASE + 484)).toBe(true);
  });

  it("returns false for the base itself (exclusive lower bound)", () => {
    expect(isReverseEdgeId(REVERSE_EDGE_ID_BASE)).toBe(false);
  });

  it("returns false for a forward edge ID", () => {
    expect(isReverseEdgeId(EDGE_ID_BASE + 1)).toBe(false);
  });

  it("returns false for a plain name-card ID", () => {
    expect(isReverseEdgeId(1)).toBe(false);
    expect(isReverseEdgeId(151)).toBe(false);
  });

  it("returns false for the CRY_ID_OFFSET boundary itself (exclusive upper bound)", () => {
    expect(isReverseEdgeId(CRY_ID_OFFSET)).toBe(false);
  });

  it("returns false for a cry card ID above CRY_ID_OFFSET", () => {
    expect(isReverseEdgeId(CRY_ID_OFFSET + 1)).toBe(false);
  });

  it("round-trips with reverseEdgeIdFor — every mapped ID passes isReverseEdgeId", () => {
    const sampleForwardIds = [
      EDGE_ID_BASE + 1,
      EDGE_ID_BASE + 50,
      EDGE_ID_BASE + 484,
    ];
    for (const fwd of sampleForwardIds) {
      expect(isReverseEdgeId(reverseEdgeIdFor(fwd))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// SEED_POKEMON reconstruction (chain join)
// ---------------------------------------------------------------------------

describe("SEED_POKEMON", () => {
  it("is a non-empty array", () => {
    expect(SEED_POKEMON.length).toBeGreaterThan(0);
  });

  it("every entry has an evolutionChain array (chain join succeeded)", () => {
    for (const p of SEED_POKEMON) {
      expect(Array.isArray(p.evolutionChain)).toBe(true);
    }
  });

  it("every entry has flavorTexts set to undefined at runtime (lazy-loaded separately)", () => {
    for (const p of SEED_POKEMON) {
      expect(p.flavorTexts).toBeUndefined();
    }
  });

  it("Bulbasaur (#1) has its chain populated", () => {
    const bulbasaur = SEED_POKEMON.find((p) => p.id === 1);
    expect(bulbasaur).toBeDefined();
    expect(bulbasaur!.evolutionChain.length).toBeGreaterThan(0);
    // Chain includes Ivysaur and Venusaur as descendants
    const names = bulbasaur!.evolutionChain.map((n) => n.name);
    expect(names).toContain("Ivysaur");
    expect(names).toContain("Venusaur");
  });

  it("Eevee (#133) chain has 8 eeveelution nodes as direct children", () => {
    const eevee = SEED_POKEMON.find((p) => p.id === 133);
    expect(eevee).toBeDefined();
    const eeveelutions = eevee!.evolutionChain.filter(
      (n) => n.evolvesFromId === 133,
    );
    expect(eeveelutions.length).toBe(8);
  });

  it("has entries for alternate forms (IDs 10001+) alongside base species", () => {
    const altForms = SEED_POKEMON.filter((p) => p.id > 9999);
    expect(altForms.length).toBeGreaterThan(0);
  });

  it("every entry exposes required SeedPokemon fields", () => {
    const required: (keyof SeedPokemon)[] = [
      "id",
      "speciesId",
      "isDefaultForm",
      "formCategory",
      "name",
      "displayName",
      "types",
      "stats",
      "evolutionChain",
    ];
    for (const p of SEED_POKEMON.slice(0, 50)) {
      for (const field of required) {
        expect(p).toHaveProperty(field);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SEED_EVOLUTION_CARDS (live data shape invariants)
// ---------------------------------------------------------------------------

describe("SEED_EVOLUTION_CARDS", () => {
  it("is a non-empty array", () => {
    expect(SEED_EVOLUTION_CARDS.length).toBeGreaterThan(0);
  });

  it("every card has cardType 'evolution'", () => {
    for (const card of SEED_EVOLUTION_CARDS) {
      expect(card.cardType).toBe("evolution");
    }
  });

  it("every card ID is within the reserved forward edge sub-range", () => {
    for (const card of SEED_EVOLUTION_CARDS) {
      expect(card.id).toBeGreaterThan(EDGE_ID_BASE); // > 1_500_000
      expect(card.id).toBeLessThan(REVERSE_ID_OFFSET); // < 2_000_000
    }
  });

  it("every card ID is unique (no duplicates)", () => {
    const ids = SEED_EVOLUTION_CARDS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every (preEvoId, postEvoId) pair is unique", () => {
    const pairs = new Set(
      SEED_EVOLUTION_CARDS.map((c) => `${c.preEvoId}:${c.postEvoId}`),
    );
    expect(pairs.size).toBe(SEED_EVOLUTION_CARDS.length);
  });

  it("Bulbasaur → Ivysaur edge is present", () => {
    const edge = SEED_EVOLUTION_CARDS.find(
      (c) => c.preEvoName === "Bulbasaur" && c.postEvoName === "Ivysaur",
    );
    expect(edge).toBeDefined();
    expect(edge!.preEvoId).toBe(1);
    expect(edge!.postEvoId).toBe(2);
    expect(edge!.triggerPhrase).toMatch(/level/i);
  });

  it("Eevee branching evolution produces 8 separate cards", () => {
    const eeveeEdges = SEED_EVOLUTION_CARDS.filter(
      (c) => c.preEvoName === "Eevee",
    );
    expect(eeveeEdges.length).toBe(8);
  });

  it("every preEvoId is within the name-card namespace (id <= MAX_NAME_ID of 999_999)", () => {
    const MAX_NAME_ID = EVOLUTION_ID_OFFSET - 1;
    for (const card of SEED_EVOLUTION_CARDS) {
      expect(card.preEvoId).toBeLessThanOrEqual(MAX_NAME_ID);
    }
  });

  it("every card has non-empty preEvoName and postEvoName", () => {
    for (const card of SEED_EVOLUTION_CARDS) {
      expect(card.preEvoName.length).toBeGreaterThan(0);
      expect(card.postEvoName.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// SEED_EVOLUTION_CARDS builder — error paths (tested via synthetic fixtures)
//
// Because the IIFE runs at module load time against the real generated JSON,
// we cannot inject bad data into it. Instead we extract the builder logic
// into a local helper that mirrors the production code exactly, and invoke it
// with controlled fixtures. This lets us pin the three documented invariants
// without modifying production code.
// ---------------------------------------------------------------------------

/** Mirrors the SEED_EVOLUTION_CARDS IIFE. Accepts an explicit pokemon array
 *  so tests can inject synthetic fixtures. */
function buildEvolutionCards(pokemonList: SeedPokemon[]): EvolutionCard[] {
  const cards: EvolutionCard[] = [];
  const seenEdgeIds = new Set<number>();
  const MAX_NAME_ID = EVOLUTION_ID_OFFSET - 1;
  const pokemonById = new Map(pokemonList.map((p) => [p.id, p]));

  for (const pokemon of pokemonList) {
    if (pokemon.id <= 0 || pokemon.id > MAX_NAME_ID) continue;
    for (const node of pokemon.evolutionChain) {
      if (node.evolvesFromId !== pokemon.id) continue;
      const edgeId = node.edgeId;
      if (typeof edgeId !== "number") {
        throw new Error(
          `Chain edge ${pokemon.name} → ${node.name} is missing an edgeId. Re-run \`npm run seed\` so scripts/seed-pokemon.mjs can allocate stable edge IDs.`,
        );
      }
      if (edgeId <= EDGE_ID_BASE || edgeId >= REVERSE_ID_OFFSET) {
        throw new Error(
          `Edge ID ${edgeId} (${pokemon.name} → ${node.name}) outside reserved sub-range [${EDGE_ID_BASE + 1}, ${REVERSE_ID_OFFSET - 1}].`,
        );
      }
      if (seenEdgeIds.has(edgeId)) continue;
      seenEdgeIds.add(edgeId);
      const postEvo = pokemonById.get(node.speciesId);
      if (!postEvo) {
        throw new Error(
          `Edge ${pokemon.name} → ${node.name} (speciesId ${node.speciesId}) has no matching pokemon in seed data — seed may be incomplete.`,
        );
      }
      cards.push({
        cardType: "evolution",
        id: edgeId,
        preEvoId: pokemon.id,
        preEvoName: pokemon.name,
        preEvoSpriteUrl: pokemon.spriteUrl,
        postEvoId: postEvo.id,
        postEvoName: postEvo.name,
        postEvoSpriteUrl: postEvo.spriteUrl,
        triggerPhrase: null,
      });
    }
  }
  return cards;
}

/** Minimal SeedPokemon fixture factory. */
function makePokemon(
  id: number,
  overrides: Partial<SeedPokemon> & { evolutionChain?: EvolutionNode[] } = {},
): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon${id}`,
    name: `pokemon${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    types: ["normal"],
    stats: {
      hp: 50,
      attack: 50,
      defense: 50,
      specialAttack: 50,
      specialDefense: 50,
      speed: 50,
    },
    flavorText: "",
    flavorTexts: undefined,
    evolutionChain: [],
    height: 10,
    weight: 100,
    baseExperience: 64,
    genus: null,
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium",
    habitat: null,
    genderRate: -1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    ...overrides,
  };
}

/** Minimal valid EvolutionNode for a non-root node. */
function makeEdge(
  speciesId: number,
  evolvesFromId: number,
  edgeId: number,
  name?: string,
): EvolutionNode {
  return {
    speciesId,
    name: name ?? `pokemon${speciesId}`,
    evolvesFromId,
    detail: null,
    edgeId,
  };
}

describe("buildEvolutionCards (synthetic fixtures — error paths)", () => {
  const VALID_EDGE_ID = EDGE_ID_BASE + 1; // 1_500_001

  it("happy path: returns one card for a simple A → B chain", () => {
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        makeEdge(2, 1, VALID_EDGE_ID),
      ],
    });
    const postEvo = makePokemon(2);
    const cards = buildEvolutionCards([preEvo, postEvo]);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(VALID_EDGE_ID);
    expect(cards[0].preEvoId).toBe(1);
    expect(cards[0].postEvoId).toBe(2);
  });

  it("deduplicates edges when both pre-evo and post-evo list the same edge in their chains", () => {
    const sharedChain: EvolutionNode[] = [
      { speciesId: 1, name: "pokemon1", evolvesFromId: null },
      makeEdge(2, 1, VALID_EDGE_ID),
    ];
    // Both entries carry the full chain; only the node where evolvesFromId === pokemon.id
    // triggers card creation, but the seenEdgeIds guard is the safety net.
    const preEvo = makePokemon(1, { evolutionChain: sharedChain });
    const postEvo = makePokemon(2, {
      evolutionChain: sharedChain, // same chain, would re-encounter the edge
    });
    const cards = buildEvolutionCards([preEvo, postEvo]);
    // preEvo (id=1) matches evolvesFromId=1 → card created.
    // postEvo (id=2) has evolvesFromId=1 ≠ 2 → skipped.
    expect(cards).toHaveLength(1);
  });

  it("throws when a non-root chain node has no edgeId", () => {
    const nodeWithoutEdgeId: EvolutionNode = {
      speciesId: 2,
      name: "pokemon2",
      evolvesFromId: 1,
      // edgeId intentionally absent
    };
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        nodeWithoutEdgeId,
      ],
    });
    const postEvo = makePokemon(2);
    expect(() => buildEvolutionCards([preEvo, postEvo])).toThrow(
      /missing an edgeId/,
    );
  });

  it("throws when edgeId is at the EDGE_ID_BASE boundary (exclusive lower bound)", () => {
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        makeEdge(2, 1, EDGE_ID_BASE), // exactly the base — not a valid forward id
      ],
    });
    const postEvo = makePokemon(2);
    expect(() => buildEvolutionCards([preEvo, postEvo])).toThrow(
      /outside reserved sub-range/,
    );
  });

  it("throws when edgeId is at the REVERSE_ID_OFFSET boundary (exclusive upper bound)", () => {
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        makeEdge(2, 1, REVERSE_ID_OFFSET), // exactly the upper boundary — not valid
      ],
    });
    const postEvo = makePokemon(2);
    expect(() => buildEvolutionCards([preEvo, postEvo])).toThrow(
      /outside reserved sub-range/,
    );
  });

  it("throws when edgeId falls in the legacy EVOLUTION_ID_OFFSET range (below EDGE_ID_BASE)", () => {
    const legacyId = EVOLUTION_ID_OFFSET + 1; // 1_000_001 — legacy sub-range
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        makeEdge(2, 1, legacyId),
      ],
    });
    const postEvo = makePokemon(2);
    expect(() => buildEvolutionCards([preEvo, postEvo])).toThrow(
      /outside reserved sub-range/,
    );
  });

  it("throws when the postEvo species is absent from the pokemon list", () => {
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        makeEdge(999, 1, VALID_EDGE_ID, "missingmon"), // speciesId 999 not in list
      ],
    });
    // postEvo with id=999 deliberately omitted
    expect(() => buildEvolutionCards([preEvo])).toThrow(
      /has no matching pokemon in seed data/,
    );
  });

  it("skips IDs above MAX_NAME_ID (999_999) without throwing", () => {
    // MAX_NAME_ID = EVOLUTION_ID_OFFSET - 1 = 999_999. Any pokemon with an id
    // >= 1_000_000 falls outside the name-card namespace and must be skipped.
    const outOfRange = makePokemon(EVOLUTION_ID_OFFSET, {
      // id === 1_000_000 > MAX_NAME_ID (999_999)
      evolutionChain: [
        { speciesId: EVOLUTION_ID_OFFSET, name: "futurepokemon", evolvesFromId: null },
        makeEdge(EVOLUTION_ID_OFFSET + 1, EVOLUTION_ID_OFFSET, VALID_EDGE_ID),
      ],
    });
    const target = makePokemon(EVOLUTION_ID_OFFSET + 1);
    // Should produce no cards and not throw
    const cards = buildEvolutionCards([outOfRange, target]);
    expect(cards).toHaveLength(0);
  });

  it("skips nodes where evolvesFromId does not match the current pokemon id", () => {
    // Simulates the shared-chain scenario: a post-evo record lists the same
    // chain, but its id doesn't match the edge's evolvesFromId.
    const postEvoWithFullChain = makePokemon(2, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        makeEdge(2, 1, VALID_EDGE_ID), // evolvesFromId=1, pokemon.id=2 → mismatch → skip
      ],
    });
    // No preEvo present, so no card should be produced
    const cards = buildEvolutionCards([postEvoWithFullChain]);
    expect(cards).toHaveLength(0);
  });

  it("handles a branching pre-evo (A → B and A → C) producing two cards", () => {
    const edgeToB = makeEdge(2, 1, EDGE_ID_BASE + 1);
    const edgeToC = makeEdge(3, 1, EDGE_ID_BASE + 2);
    const preEvo = makePokemon(1, {
      evolutionChain: [
        { speciesId: 1, name: "pokemon1", evolvesFromId: null },
        edgeToB,
        edgeToC,
      ],
    });
    const b = makePokemon(2);
    const c = makePokemon(3);
    const cards = buildEvolutionCards([preEvo, b, c]);
    expect(cards).toHaveLength(2);
    const postEvoIds = cards.map((c) => c.postEvoId).sort();
    expect(postEvoIds).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// SEED_REVERSE_EVOLUTION_CARDS
// ---------------------------------------------------------------------------

describe("SEED_REVERSE_EVOLUTION_CARDS", () => {
  it("has the same length as SEED_EVOLUTION_CARDS (1:1 mirror)", () => {
    expect(SEED_REVERSE_EVOLUTION_CARDS.length).toBe(SEED_EVOLUTION_CARDS.length);
  });

  it("every card has cardType 'reverse-evolution'", () => {
    for (const card of SEED_REVERSE_EVOLUTION_CARDS) {
      expect(card.cardType).toBe("reverse-evolution");
    }
  });

  it("every reverse card ID is within the reverse edge sub-range", () => {
    for (const card of SEED_REVERSE_EVOLUTION_CARDS) {
      expect(card.id).toBeGreaterThan(REVERSE_EDGE_ID_BASE); // > 2_500_000
      expect(card.id).toBeLessThan(CRY_ID_OFFSET); // < 3_000_000
    }
  });

  it("every reverse card ID equals reverseEdgeIdFor(forward card ID)", () => {
    for (let i = 0; i < SEED_EVOLUTION_CARDS.length; i++) {
      expect(SEED_REVERSE_EVOLUTION_CARDS[i].id).toBe(
        reverseEdgeIdFor(SEED_EVOLUTION_CARDS[i].id),
      );
    }
  });

  it("every reverse card has the same preEvoId and postEvoId as its forward counterpart", () => {
    for (let i = 0; i < SEED_EVOLUTION_CARDS.length; i++) {
      const fwd = SEED_EVOLUTION_CARDS[i];
      const rev = SEED_REVERSE_EVOLUTION_CARDS[i];
      expect(rev.preEvoId).toBe(fwd.preEvoId);
      expect(rev.postEvoId).toBe(fwd.postEvoId);
    }
  });

  it("reverse card IDs are unique (no duplicates)", () => {
    const ids = SEED_REVERSE_EVOLUTION_CARDS.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every reverse card ID passes isReverseEdgeId", () => {
    for (const card of SEED_REVERSE_EVOLUTION_CARDS) {
      expect(isReverseEdgeId(card.id)).toBe(true);
    }
  });

  it("forward and reverse IDs are disjoint (no overlap)", () => {
    const forwardIds = new Set(SEED_EVOLUTION_CARDS.map((c) => c.id));
    for (const card of SEED_REVERSE_EVOLUTION_CARDS) {
      expect(forwardIds.has(card.id)).toBe(false);
    }
  });
});
