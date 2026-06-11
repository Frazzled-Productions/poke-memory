// scripts/seed-pokemon.test.mjs
// Unit tests for pure helper functions in seed-pokemon.mjs.
//
// These tests exercise the logic WITHOUT hitting PokéAPI or the filesystem.
// Run with: npx vitest run --project node scripts/seed-pokemon.test.mjs

import { describe, it, expect } from "vitest";
import { flattenChain, buildVarietiesLookup, addFormEdges, trimDetail } from "./seed-pokemon.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal idToName map for tests. */
const ID_TO_NAME = new Map([
  [26, "Raichu"],
  [19, "Rattata"],
  [20, "Raticate"],
]);

/**
 * Build a minimal PokéAPI chain node with the given speciesId and
 * evolution_details array.
 */
function makeChainNode(speciesId, evolutionDetails = [], evolvesTo = []) {
  return {
    species: { url: `https://pokeapi.co/api/v2/pokemon-species/${speciesId}/` },
    evolution_details: evolutionDetails,
    evolves_to: evolvesTo,
  };
}

// ---------------------------------------------------------------------------
// flattenChain - F17: prefer region-tagged detail entry
// ---------------------------------------------------------------------------

describe("flattenChain - prefers region-tagged evolution_details entry (F17)", () => {
  it("picks the region-tagged detail when it appears after a null-region entry", () => {
    // Raichu's real PokéAPI shape: [{thunder-stone, region:null}, {thunder-stone, region:{name:"alola"}}]
    const chainNode = makeChainNode(
      26,
      [
        { item: { name: "thunder-stone" }, region: null, trigger: { name: "use-item" } },
        { item: { name: "thunder-stone" }, region: { name: "alola" }, trigger: { name: "use-item" } },
      ],
    );
    const rootNode = makeChainNode(25, [], [chainNode]); // Pikachu → Raichu
    const nodes = flattenChain(rootNode, null, ID_TO_NAME);

    // flattenChain returns nodes for Pikachu and Raichu.
    const raichuNode = nodes.find((n) => n.speciesId === 26);
    expect(raichuNode).toBeDefined();
    // The chosen detail must have region:"alola" (after trimDetail strips non-null region).
    expect(raichuNode.detail.region).toBe("alola");
  });

  it("falls back to details[0] when no region-tagged entry exists", () => {
    const chainNode = makeChainNode(
      26,
      [{ item: { name: "thunder-stone" }, region: null, trigger: { name: "use-item" } }],
    );
    const rootNode = makeChainNode(25, [], [chainNode]);
    const nodes = flattenChain(rootNode, null, ID_TO_NAME);

    const raichuNode = nodes.find((n) => n.speciesId === 26);
    expect(raichuNode).toBeDefined();
    expect(raichuNode.detail.region).toBeNull();
  });

  it("returns null detail when evolution_details is empty", () => {
    const chainNode = makeChainNode(26, []);
    const rootNode = makeChainNode(25, [], [chainNode]);
    const nodes = flattenChain(rootNode, null, ID_TO_NAME);

    const raichuNode = nodes.find((n) => n.speciesId === 26);
    expect(raichuNode.detail).toBeNull();
  });

  it("correctly sets evolvesFromId on child nodes", () => {
    const raichuNode = makeChainNode(
      26,
      [{ item: { name: "thunder-stone" }, region: { name: "alola" }, trigger: { name: "use-item" } }],
    );
    const pikaNode = makeChainNode(25, [], [raichuNode]);
    const nodes = flattenChain(pikaNode, null, ID_TO_NAME);

    const raichu = nodes.find((n) => n.speciesId === 26);
    expect(raichu.evolvesFromId).toBe(25);
  });
});

describe("flattenChain - flattens a simple two-step chain", () => {
  it("returns two nodes for a single evolution", () => {
    const child = makeChainNode(20, [{ trigger: { name: "level-up" }, region: null }]);
    const root = makeChainNode(19, [], [child]);
    const nodes = flattenChain(root, null, ID_TO_NAME);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].speciesId).toBe(19);
    expect(nodes[1].speciesId).toBe(20);
  });

  it("sets evolvesFromId to null for the root", () => {
    const root = makeChainNode(19, []);
    const nodes = flattenChain(root, null, ID_TO_NAME);
    expect(nodes[0].evolvesFromId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildVarietiesLookup - F17: keys by regional prefix
// ---------------------------------------------------------------------------

describe("buildVarietiesLookup - keys by regional prefix (F17)", () => {
  it("indexes a multi-segment regional slug by its prefix only", () => {
    // formSlug "galar-standard" → key "galar"
    const records = [
      { speciesId: 555, isDefaultForm: false, formSlug: "galar-standard", id: 10177, displayName: "Galarian Darmanitan" },
    ];
    const lookup = buildVarietiesLookup(records);
    const varietyMap = lookup.get(555);
    expect(varietyMap).toBeDefined();
    expect(varietyMap.has("galar")).toBe(true);
    expect(varietyMap.has("galar-standard")).toBe(false);
  });

  it("indexes a single-segment regional slug without modification", () => {
    // formSlug "alola" → key "alola" (split("-")[0] === "alola")
    const records = [
      { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
    ];
    const lookup = buildVarietiesLookup(records);
    const varietyMap = lookup.get(26);
    expect(varietyMap).toBeDefined();
    expect(varietyMap.has("alola")).toBe(true);
  });

  it("ignores non-regional form slugs (e.g. mega, gmax)", () => {
    const records = [
      { speciesId: 6, isDefaultForm: false, formSlug: "mega-x", id: 10043, displayName: "Mega Charizard X" },
      { speciesId: 6, isDefaultForm: false, formSlug: "gmax", id: 10197, displayName: "Giganatamax Charizard" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.has(6)).toBe(false);
  });

  it("ignores default form records", () => {
    const records = [
      { speciesId: 26, isDefaultForm: true, formSlug: null, id: 26, displayName: "Raichu" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.has(26)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addFormEdges - F17: end-to-end form-aware edge generation
// ---------------------------------------------------------------------------

describe("addFormEdges - generates form-aware edges for regional variants (F17)", () => {
  it("emits an additional edge node for Alolan Raichu", () => {
    // Pikachu (25) → Raichu (26) with region:"alola" detail
    const nodes = [
      { speciesId: 25, name: "Pikachu", evolvesFromId: null, detail: null },
      { speciesId: 26, name: "Raichu", evolvesFromId: 25, detail: { region: "alola", item: "thunder-stone" } },
    ];
    // lookup: species 26 has alolan form at id 10100
    const lookup = new Map([
      [26, new Map([["alola", { pokemonId: 10100, displayName: "Alolan Raichu" }]])],
    ]);

    const expanded = addFormEdges(nodes, lookup);
    // Should have original 2 + 1 form-aware edge
    expect(expanded).toHaveLength(3);
    const formEdge = expanded.find((n) => n.speciesId === 10100);
    expect(formEdge).toBeDefined();
    expect(formEdge.evolvesFromId).toBe(25); // parent has no alolan variant, falls back to speciesId
    expect(formEdge.name).toBe("Alolan Raichu");
  });

  it("uses the parent's form pokemonId when the parent also has a regional variant", () => {
    // E.g. a hypothetical chain where both parent and child have regional variants
    const nodes = [
      { speciesId: 1, name: "Base", evolvesFromId: null, detail: null },
      { speciesId: 2, name: "Evo", evolvesFromId: 1, detail: { region: "galar" } },
    ];
    const lookup = new Map([
      [1, new Map([["galar", { pokemonId: 10001, displayName: "Galarian Base" }]])],
      [2, new Map([["galar", { pokemonId: 10002, displayName: "Galarian Evo" }]])],
    ]);

    const expanded = addFormEdges(nodes, lookup);
    const formEdge = expanded.find((n) => n.speciesId === 10002);
    expect(formEdge).toBeDefined();
    expect(formEdge.evolvesFromId).toBe(10001); // uses parent form id
  });

  it("skips a form edge when the child has no matching regional variant", () => {
    const nodes = [
      { speciesId: 1, name: "Base", evolvesFromId: null, detail: null },
      { speciesId: 2, name: "Evo", evolvesFromId: 1, detail: { region: "hisui" } },
    ];
    const lookup = new Map(); // no hisuian form for species 2

    const expanded = addFormEdges(nodes, lookup);
    expect(expanded).toHaveLength(2); // no extra edge added
  });

  it("strips region from the persisted form-edge detail", () => {
    const nodes = [
      { speciesId: 25, name: "Pikachu", evolvesFromId: null, detail: null },
      { speciesId: 26, name: "Raichu", evolvesFromId: 25, detail: { region: "alola", item: "thunder-stone", trigger: "use-item" } },
    ];
    const lookup = new Map([
      [26, new Map([["alola", { pokemonId: 10100, displayName: "Alolan Raichu" }]])],
    ]);

    const expanded = addFormEdges(nodes, lookup);
    const formEdge = expanded.find((n) => n.speciesId === 10100);
    expect(formEdge.detail).toBeDefined();
    expect(formEdge.detail.region).toBeUndefined();
    expect(formEdge.detail.item).toBe("thunder-stone");
  });

  it("does not duplicate nodes via dedup key", () => {
    // Two nodes with the same (evolvesFromId, speciesId) should only produce one output.
    const nodes = [
      { speciesId: 25, name: "Pikachu", evolvesFromId: null, detail: null },
      { speciesId: 26, name: "Raichu", evolvesFromId: 25, detail: { region: "alola" } },
      { speciesId: 26, name: "Raichu", evolvesFromId: 25, detail: { region: "alola" } }, // duplicate
    ];
    const lookup = new Map([
      [26, new Map([["alola", { pokemonId: 10100, displayName: "Alolan Raichu" }]])],
    ]);

    const expanded = addFormEdges(nodes, lookup);
    const count10100 = expanded.filter((n) => n.speciesId === 10100).length;
    expect(count10100).toBe(1);
  });
});
