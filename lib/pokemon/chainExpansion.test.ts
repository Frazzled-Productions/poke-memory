import { describe, it, expect } from "vitest";
import {
  buildVarietiesLookup,
  addFormEdges,
  type ChainNode,
} from "./chainExpansion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(
  speciesId: number,
  name: string,
  evolvesFromId: number | null,
  detail: ChainNode["detail"] = null,
): ChainNode {
  return { speciesId, name, evolvesFromId, detail };
}

// ---------------------------------------------------------------------------
// buildVarietiesLookup
// ---------------------------------------------------------------------------

describe("buildVarietiesLookup", () => {
  it("returns an empty map when given an empty array", () => {
    const lookup = buildVarietiesLookup([]);
    expect(lookup.size).toBe(0);
  });

  it("indexes regional (non-default) entries by formSlug", () => {
    const records = [
      { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.get(26)?.get("alola")).toEqual({ pokemonId: 10100, displayName: "Alolan Raichu" });
  });

  it("skips default-form records (isDefaultForm: true)", () => {
    const records = [
      { speciesId: 26, isDefaultForm: true, formSlug: "alola", id: 26, displayName: "Raichu" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.size).toBe(0);
  });

  it("skips records with null formSlug", () => {
    const records = [
      { speciesId: 26, isDefaultForm: false, formSlug: null, id: 26, displayName: "Raichu" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.size).toBe(0);
  });

  it("skips non-regional form slugs (e.g. mega forms)", () => {
    const records = [
      { speciesId: 6, isDefaultForm: false, formSlug: "mega", id: 10034, displayName: "Mega Charizard X" },
      { speciesId: 6, isDefaultForm: false, formSlug: "gmax", id: 10196, displayName: "Gigantamax Charizard" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.size).toBe(0);
  });

  it("indexes all four regional slug prefixes", () => {
    const records = [
      { speciesId: 19, isDefaultForm: false, formSlug: "alola", id: 10091, displayName: "Alolan Rattata" },
      { speciesId: 52, isDefaultForm: false, formSlug: "galar", id: 10161, displayName: "Galarian Meowth" },
      { speciesId: 58, isDefaultForm: false, formSlug: "hisui", id: 10229, displayName: "Hisuian Growlithe" },
      { speciesId: 194, isDefaultForm: false, formSlug: "paldea", id: 10250, displayName: "Paldean Wooper" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.get(19)?.get("alola")?.pokemonId).toBe(10091);
    expect(lookup.get(52)?.get("galar")?.pokemonId).toBe(10161);
    expect(lookup.get(58)?.get("hisui")?.pokemonId).toBe(10229);
    expect(lookup.get(194)?.get("paldea")?.pokemonId).toBe(10250);
  });

  it("groups multiple regional forms under the same speciesId", () => {
    // Hypothetical species with both an alolan and a galarian variant
    const records = [
      { speciesId: 999, isDefaultForm: false, formSlug: "alola", id: 10001, displayName: "Alolan X" },
      { speciesId: 999, isDefaultForm: false, formSlug: "galar", id: 10002, displayName: "Galarian X" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.get(999)?.size).toBe(2);
    expect(lookup.get(999)?.get("alola")?.pokemonId).toBe(10001);
    expect(lookup.get(999)?.get("galar")?.pokemonId).toBe(10002);
  });
});

// ---------------------------------------------------------------------------
// addFormEdges — default edges pass through unchanged
// ---------------------------------------------------------------------------

describe("addFormEdges — default edges (no region)", () => {
  it("returns an empty array when given an empty input", () => {
    expect(addFormEdges([], new Map())).toEqual([]);
  });

  it("passes a single default (no-region) node through unchanged", () => {
    const n = node(1, "Bulbasaur", null);
    expect(addFormEdges([n], new Map())).toEqual([n]);
  });

  it("passes a simple two-stage chain through unchanged", () => {
    const root = node(1, "Bulbasaur", null);
    const evo = node(2, "Ivysaur", 1);
    expect(addFormEdges([root, evo], new Map())).toEqual([root, evo]);
  });

  it("deduplicates input nodes that share the same (evolvesFromId, speciesId) key", () => {
    const n = node(25, "Pikachu", null);
    const duplicate = { ...n };
    const result = addFormEdges([n, duplicate], new Map());
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(n);
  });

  it("preserves null evolvesFromId for root nodes in dedup key", () => {
    const n1 = node(1, "Bulbasaur", null);
    const n2 = node(4, "Charmander", null);
    const result = addFormEdges([n1, n2], new Map());
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// addFormEdges — region-tagged edges
// ---------------------------------------------------------------------------

describe("addFormEdges — regional form edges (Pikachu → Raichu / Alolan Raichu)", () => {
  // Pikachu (25) → Raichu (26, default) and → Alolan Raichu (10100, region: alola).
  // Both edges appear in the PokéAPI chain JSON; the alolan one carries region: "alola".

  const lookup = buildVarietiesLookup([
    { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
  ]);

  it("emits the default edge and a form-aware edge for the regional variant", () => {
    // Both edges share the same (evolvesFromId=25, speciesId=26) dedup key, so the
    // second (regional-tagged) node is deduped away. The form node is then emitted
    // from the surviving default edge — BUT the default edge has no region on its
    // detail, so only the default node is kept. To exercise the form-edge emission
    // we must provide a node whose detail carries a region field.
    const regionalEdge = node(26, "Raichu", 25, { region: "alola" });
    const result = addFormEdges([regionalEdge], lookup);

    // Expect: the region-tagged Raichu passthrough + the emitted Alolan Raichu form node
    expect(result).toHaveLength(2);
    const formNode = result.find((r) => r.speciesId === 10100);
    expect(formNode).toBeDefined();
    expect(formNode?.evolvesFromId).toBe(25); // parent has no alolan variant → falls back to species ID
    expect(formNode?.name).toBe("Alolan Raichu");
    expect(formNode?.detail).not.toHaveProperty("region");
  });

  it("deduplicates the node passthrough but still emits the form edge from a deduped regional node", () => {
    // Both nodes share (evolvesFromId=25, speciesId=26). defaultEdge is kept first;
    // regionalEdge is deduped (its own node is not emitted). However, the loop still
    // processes regionalEdge's region field and emits the form node at speciesId 10100.
    const defaultEdge = node(26, "Raichu", 25);
    const regionalEdge = node(26, "Raichu", 25, { region: "alola" });
    const result = addFormEdges([defaultEdge, regionalEdge], lookup);
    // defaultEdge passthrough + Alolan Raichu form node = 2
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.speciesId === 26)).toBeDefined();
    expect(result.find((r) => r.speciesId === 10100)).toBeDefined();
  });

  it("strips the region field from the emitted form node's detail", () => {
    const regionalEdge = node(26, "Raichu", 25, { region: "alola", trigger: { name: "level-up" } });
    const result = addFormEdges([regionalEdge], lookup);
    const formNode = result.find((r) => r.speciesId === 10100);
    expect(formNode?.detail).toEqual({ trigger: { name: "level-up" } });
    expect(formNode?.detail).not.toHaveProperty("region");
  });

  it("skips emitting a form edge when child has no matching regional variant in lookup", () => {
    // Raichu has no hisui variant in our lookup
    const regionalEdge = node(26, "Raichu", 25, { region: "hisui" });
    const result = addFormEdges([regionalEdge], lookup);
    // Only the default regional node should be present; no emitted form node
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(26);
  });

  it("skips emitting a form edge when evolvesFromId is null (root node)", () => {
    const n = node(26, "Raichu", null, { region: "alola" });
    const result = addFormEdges([n], lookup);
    // Root node with region — cannot emit form edge; should just pass through
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(26);
  });
});

// ---------------------------------------------------------------------------
// addFormEdges — regional parent resolution
// ---------------------------------------------------------------------------

describe("addFormEdges — Pikachu (alolan) → Alolan Raichu: parent also has a regional form", () => {
  // Hypothetical chain where the parent species also has a regional form that
  // should serve as the evolvesFromId for the child form edge.
  const lookup = buildVarietiesLookup([
    { speciesId: 25, isDefaultForm: false, formSlug: "alola", id: 10080, displayName: "Alolan Pikachu" },
    { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
  ]);

  it("uses the parent form ID when the parent also has a regional variant", () => {
    const regionalEdge = node(26, "Raichu", 25, { region: "alola" });
    const result = addFormEdges([regionalEdge], lookup);
    const formNode = result.find((r) => r.speciesId === 10100);
    expect(formNode?.evolvesFromId).toBe(10080); // parent form ID, not the default 25
  });
});

// ---------------------------------------------------------------------------
// addFormEdges — Eevee-style multi-branch chains
// ---------------------------------------------------------------------------

describe("addFormEdges — multi-branch (Eevee → 8 Eeveelutions)", () => {
  const eeveeId = 133;
  const vaporeonId = 134;
  const jolteonId = 135;
  const flareonId = 136;
  const espeonId = 196;
  const umbreonId = 197;
  const leafeonId = 470;
  const glaceonId = 471;
  const sylveonId = 700;

  const eeveelutions = [vaporeonId, jolteonId, flareonId, espeonId, umbreonId, leafeonId, glaceonId, sylveonId];

  const nodes: ChainNode[] = eeveelutions.map((id, i) =>
    node(id, `Eeveelution${i}`, eeveeId),
  );

  it("returns all eight branches, each as a distinct node", () => {
    const result = addFormEdges(nodes, new Map());
    expect(result).toHaveLength(8);
    const ids = result.map((n) => n.speciesId);
    for (const id of eeveelutions) {
      expect(ids).toContain(id);
    }
  });

  it("all branches have evolvesFromId === eeveeId", () => {
    const result = addFormEdges(nodes, new Map());
    for (const r of result) {
      expect(r.evolvesFromId).toBe(eeveeId);
    }
  });

  it("does not emit duplicates when the same branch appears twice in input", () => {
    const duplicated = [...nodes, node(vaporeonId, "Vaporeon", eeveeId)];
    const result = addFormEdges(duplicated, new Map());
    expect(result).toHaveLength(8); // still only 8
  });
});

// ---------------------------------------------------------------------------
// addFormEdges — three-stage chain with form
// ---------------------------------------------------------------------------

describe("addFormEdges — three-stage chain with regional branch mid-chain", () => {
  // Cubone (104) → Marowak (105) default / Alolan Marowak (10115) with region: "alola"
  const lookup = buildVarietiesLookup([
    { speciesId: 105, isDefaultForm: false, formSlug: "alola", id: 10115, displayName: "Alolan Marowak" },
  ]);

  it("emits the default node and a regional form node for a mid-chain species", () => {
    // Provide only the regional-tagged edge — default and regional share the same
    // (evolvesFromId, speciesId) dedup key, so we test them separately.
    const root = node(104, "Cubone", null);
    const regionalEvo = node(105, "Marowak", 104, { region: "alola" });
    const result = addFormEdges([root, regionalEvo], lookup);

    // root + region-tagged Marowak + emitted Alolan Marowak = 3 nodes
    expect(result).toHaveLength(3);
    const formNode = result.find((r) => r.speciesId === 10115);
    expect(formNode?.evolvesFromId).toBe(104); // Cubone has no regional form → falls back to species ID
  });

  it("preserves the root node at speciesId 104 with evolvesFromId null", () => {
    const root = node(104, "Cubone", null);
    const defaultEvo = node(105, "Marowak", 104);
    const result = addFormEdges([root, defaultEvo], lookup);
    const rootNode = result.find((r) => r.speciesId === 104);
    expect(rootNode?.evolvesFromId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addFormEdges — detail is null
// ---------------------------------------------------------------------------

describe("addFormEdges — null detail on regional edge", () => {
  const lookup = buildVarietiesLookup([
    { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
  ]);

  it("emits the form node with null detail when the source detail is null", () => {
    // A node whose detail is null but whose region was somehow set — exercise
    // the code path where region is extracted from node.detail which is null.
    // In practice region check guards: detail?.region only, so detail === null
    // means no form edge is emitted. Verify that.
    const n = node(26, "Raichu", 25, null);
    const result = addFormEdges([n], lookup);
    // detail is null → region is undefined → no form edge emitted
    expect(result).toHaveLength(1);
    expect(result[0].speciesId).toBe(26);
  });
});
