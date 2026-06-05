import { describe, it, expect } from "vitest";
import {
  isStubEntry,
  isWorthLearning,
  formCategoryFor,
  slugToDisplayName,
} from "./forms";
import {
  buildVarietiesLookup,
  addFormEdges,
  type ChainNode,
  type VarietiesLookup,
} from "./chainExpansion";

// ---------------------------------------------------------------------------
// Fixtures - representative PokéAPI shapes (trimmed to relevant fields)
// ---------------------------------------------------------------------------

/** Alolan Raichu (pokemon ID 10100, species 26) */
const alolanRaichuPokemon = {
  base_experience: 218,
  moves: [{ move: { name: "thunder-shock" } }],
};
const alolanRaichuForm = {
  form_name: "alola",
  is_battle_only: false,
  is_default: false,
};

/** Mega Charizard X (pokemon ID 10034, species 6) */
const megaCharizardXPokemon = {
  base_experience: 285,
  moves: [{ move: { name: "flamethrower" } }],
};
const megaCharizardXForm = {
  form_name: "mega-x",
  is_battle_only: true,
  is_default: false,
};

/**
 * Vivillon-Meadow: cosmetic variant - does not appear in varieties[] at all
 * (all Vivillon share the same pokemon_id). This filter is never reached for
 * Vivillon; tested here for documentation purposes only.
 */
const vivillonMeadowPokemon = {
  base_experience: 185,
  moves: [{ move: { name: "tackle" } }],
};
const vivillonMeadowForm = {
  form_name: "meadow",
  is_battle_only: false,
  is_default: true, // Vivillon-Meadow is the default variety
};

/**
 * Stub Mega (e.g. IDs 10278+) - fan-wiki entry with no real game data.
 */
const stubMegaPokemon = {
  base_experience: null,
  moves: [],
};
const stubMegaForm = {
  form_name: "mega",
  is_battle_only: true,
  is_default: false,
};

/** Hisuian Cyndaquil (pokemon ID 10250, species 155) */
const hisuianCyndaquilPokemon = {
  base_experience: 62,
  moves: [{ move: { name: "tackle" } }],
};
const hisuianCyndaquilForm = {
  form_name: "hisui",
  is_battle_only: false,
  is_default: false,
};

/** Totem Togedemaru (pokemon ID 10162, species 777) */
const totemTogedemaruPokemon = {
  base_experience: 152,
  moves: [{ move: { name: "tackle" } }],
};
const totemTogedemaruForm = {
  form_name: "totem",
  is_battle_only: false,
  is_default: false,
};

/** Minior Meteor (any colour) */
const miniorMeteorPokemon = {
  base_experience: 154,
  moves: [{ move: { name: "tackle" } }],
};
const miniorMeteorForm = {
  form_name: "red-meteor",
  is_battle_only: false,
  is_default: false,
};

/** Koraidon Limited Build (ride mode) */
const koraidonLimitedPokemon = {
  base_experience: null,
  moves: [],
};
const koraidonLimitedForm = {
  form_name: "limited-build",
  is_battle_only: false,
  is_default: false,
};

// ---------------------------------------------------------------------------
// isStubEntry
// ---------------------------------------------------------------------------

describe("isStubEntry", () => {
  it("returns true for a null base_experience + empty moves (stub Mega)", () => {
    expect(isStubEntry(stubMegaPokemon)).toBe(true);
  });

  it("returns false for a normal Pokémon with experience and moves", () => {
    expect(isStubEntry(alolanRaichuPokemon)).toBe(false);
  });

  it("returns false when base_experience is 0 (edge case - some baby Pokémon)", () => {
    expect(isStubEntry({ base_experience: 0, moves: [] })).toBe(false);
  });

  it("returns false when base_experience is null but moves is non-empty", () => {
    expect(
      isStubEntry({ base_experience: null, moves: [{ move: { name: "tackle" } }] })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isWorthLearning
// ---------------------------------------------------------------------------

describe("isWorthLearning", () => {
  it("includes Alolan Raichu (regional, not battle-only, non-empty form_name)", () => {
    expect(isWorthLearning(alolanRaichuForm, alolanRaichuPokemon)).toBe(true);
  });

  it("excludes Mega Charizard X (is_battle_only: true)", () => {
    expect(isWorthLearning(megaCharizardXForm, megaCharizardXPokemon)).toBe(false);
  });

  it("excludes stub Mega (base_experience null, no moves)", () => {
    expect(isWorthLearning(stubMegaForm, stubMegaPokemon)).toBe(false);
  });

  it("includes Hisuian Cyndaquil (regional, not battle-only)", () => {
    expect(isWorthLearning(hisuianCyndaquilForm, hisuianCyndaquilPokemon)).toBe(true);
  });

  it("excludes Totem Togedemaru (form_name === 'totem')", () => {
    expect(isWorthLearning(totemTogedemaruForm, totemTogedemaruPokemon)).toBe(false);
  });

  it("excludes Minior meteor forms (form_name ends with -meteor)", () => {
    expect(isWorthLearning(miniorMeteorForm, miniorMeteorPokemon)).toBe(false);
  });

  it("excludes Koraidon Limited Build (ride-mode form pattern)", () => {
    expect(isWorthLearning(koraidonLimitedForm, koraidonLimitedPokemon)).toBe(false);
  });

  it("excludes forms with empty form_name (treated as default)", () => {
    expect(
      isWorthLearning(
        { form_name: "", is_battle_only: false },
        { base_experience: 100, moves: [{ move: { name: "tackle" } }] }
      )
    ).toBe(false);
  });

  it("Vivillon-Meadow: is_default=true means form_name may differ - included if non-empty & non-battle-only", () => {
    // Cosmetic pattern forms don't appear in varieties[] in practice; this
    // test documents that the filter alone doesn't exclude Vivillon-Meadow - 
    // it would be included if it appeared as a variety. The correct exclusion
    // mechanism is that cosmetic forms share a pokemon_id and are absent from
    // varieties[].
    expect(isWorthLearning(vivillonMeadowForm, vivillonMeadowPokemon)).toBe(true);
  });

  it("excludes gliding/sprinting/swimming ride forms via pattern match", () => {
    const rideForms = [
      "sprinting-build",
      "swimming-build",
      "gliding-build",
      "aquatic-build",
      "low-power-mode",
    ];
    for (const formName of rideForms) {
      expect(
        isWorthLearning(
          { form_name: formName, is_battle_only: false },
          { base_experience: 100, moves: [{ move: { name: "tackle" } }] }
        )
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// formCategoryFor
// ---------------------------------------------------------------------------

describe("formCategoryFor", () => {
  it("classifies alola as 'regional'", () => {
    expect(formCategoryFor({ form_name: "alola" })).toBe("regional");
  });

  it("classifies galar as 'regional'", () => {
    expect(formCategoryFor({ form_name: "galar" })).toBe("regional");
  });

  it("classifies hisui as 'regional'", () => {
    expect(formCategoryFor({ form_name: "hisui" })).toBe("regional");
  });

  it("classifies paldea as 'regional'", () => {
    expect(formCategoryFor({ form_name: "paldea" })).toBe("regional");
  });

  it("classifies paldea-combat-breed Tauros as 'regional'", () => {
    expect(formCategoryFor({ form_name: "paldea-combat-breed" })).toBe("regional");
  });

  it("classifies mega-x as 'mega'", () => {
    expect(formCategoryFor({ form_name: "mega-x" })).toBe("mega");
  });

  it("classifies mega as 'mega'", () => {
    expect(formCategoryFor({ form_name: "mega" })).toBe("mega");
  });

  it("classifies gmax as 'gmax'", () => {
    expect(formCategoryFor({ form_name: "gmax" })).toBe("gmax");
  });

  it("classifies primal as 'primal'", () => {
    expect(formCategoryFor({ form_name: "primal" })).toBe("primal");
  });

  it("classifies empty form_name as 'default'", () => {
    expect(formCategoryFor({ form_name: "" })).toBe("default");
  });

  it("classifies null form_name as 'default'", () => {
    expect(formCategoryFor({ form_name: null })).toBe("default");
  });

  it("classifies is_default=true as 'default' even when form_name is missing", () => {
    expect(formCategoryFor({ is_default: true })).toBe("default");
  });

  it("classifies Rotom appliance as 'forme'", () => {
    expect(formCategoryFor({ form_name: "heat" })).toBe("forme");
  });

  it("classifies Deoxys attack as 'forme'", () => {
    expect(formCategoryFor({ form_name: "attack" })).toBe("forme");
  });

  it("classifies Ogerpon-hearthflame as 'forme'", () => {
    expect(formCategoryFor({ form_name: "hearthflame-mask" })).toBe("forme");
  });

  it("classifies Zacian crowned as 'forme'", () => {
    expect(formCategoryFor({ form_name: "crowned-sword" })).toBe("forme");
  });

  it("classifies Pikachu original-cap as 'forme'", () => {
    expect(formCategoryFor({ form_name: "original-cap" })).toBe("forme");
  });
});

// ---------------------------------------------------------------------------
// slugToDisplayName
// ---------------------------------------------------------------------------

describe("slugToDisplayName", () => {
  it("title-cases each word in a hyphenated slug", () => {
    expect(slugToDisplayName("alolan-raichu")).toBe("Alolan Raichu");
  });

  it("handles single-word slugs", () => {
    expect(slugToDisplayName("raichu")).toBe("Raichu");
  });

  it("handles multi-part slugs", () => {
    expect(slugToDisplayName("mega-charizard-x")).toBe("Mega Charizard X");
  });
});

// ---------------------------------------------------------------------------
// buildVarietiesLookup
// ---------------------------------------------------------------------------

describe("buildVarietiesLookup", () => {
  it("indexes regional forms by (speciesId, formSlug)", () => {
    const records = [
      { speciesId: 26, isDefaultForm: true, formSlug: null, id: 26, displayName: "Raichu" },
      { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.get(26)?.get("alola")).toEqual({ pokemonId: 10100, displayName: "Alolan Raichu" });
  });

  it("excludes default forms and non-regional slugs", () => {
    const records = [
      { speciesId: 6, isDefaultForm: true, formSlug: null, id: 6, displayName: "Charizard" },
      { speciesId: 6, isDefaultForm: false, formSlug: "mega-x", id: 10034, displayName: "Mega Charizard X" },
    ];
    const lookup = buildVarietiesLookup(records);
    // mega-x is not a regional slug - must not appear
    expect(lookup.get(6)).toBeUndefined();
  });

  it("indexes all four regional slug prefixes", () => {
    const records = [
      { speciesId: 52, isDefaultForm: false, formSlug: "alola", id: 10161, displayName: "Alolan Meowth" },
      { speciesId: 52, isDefaultForm: false, formSlug: "galar", id: 10177, displayName: "Galarian Meowth" },
      { speciesId: 155, isDefaultForm: false, formSlug: "hisui", id: 10229, displayName: "Hisuian Cyndaquil" },
      { speciesId: 194, isDefaultForm: false, formSlug: "paldea", id: 10250, displayName: "Paldean Wooper" },
    ];
    const lookup = buildVarietiesLookup(records);
    expect(lookup.get(52)?.get("alola")?.pokemonId).toBe(10161);
    expect(lookup.get(52)?.get("galar")?.pokemonId).toBe(10177);
    expect(lookup.get(155)?.get("hisui")?.pokemonId).toBe(10229);
    expect(lookup.get(194)?.get("paldea")?.pokemonId).toBe(10250);
  });
});

// ---------------------------------------------------------------------------
// addFormEdges - chain-expansion logic
// ---------------------------------------------------------------------------

// Varieties lookup used across the chain-expansion tests below.
// Covers the Hisuian Cyndaquil line (10229/10230/10231) and Alolan Raichu (10100).
const testLookup: VarietiesLookup = buildVarietiesLookup([
  // Default forms (excluded by buildVarietiesLookup)
  { speciesId: 155, isDefaultForm: true, formSlug: null, id: 155, displayName: "Cyndaquil" },
  { speciesId: 156, isDefaultForm: true, formSlug: null, id: 156, displayName: "Quilava" },
  { speciesId: 157, isDefaultForm: true, formSlug: null, id: 157, displayName: "Typhlosion" },
  { speciesId: 172, isDefaultForm: true, formSlug: null, id: 172, displayName: "Pichu" },
  { speciesId: 25, isDefaultForm: true, formSlug: null, id: 25, displayName: "Pikachu" },
  { speciesId: 26, isDefaultForm: true, formSlug: null, id: 26, displayName: "Raichu" },
  // Regional forms
  { speciesId: 155, isDefaultForm: false, formSlug: "hisui", id: 10229, displayName: "Hisuian Cyndaquil" },
  { speciesId: 156, isDefaultForm: false, formSlug: "hisui", id: 10230, displayName: "Hisuian Quilava" },
  { speciesId: 157, isDefaultForm: false, formSlug: "hisui", id: 10231, displayName: "Hisuian Typhlosion" },
  { speciesId: 26, isDefaultForm: false, formSlug: "alola", id: 10100, displayName: "Alolan Raichu" },
]);

// ---------------------------------------------------------------------------
// Helper: build a minimal chain node.
// ---------------------------------------------------------------------------
function node(
  speciesId: number,
  evolvesFromId: number | null,
  region: string | null = null,
): ChainNode {
  return {
    speciesId,
    name: `Species${speciesId}`,
    evolvesFromId,
    detail: evolvesFromId === null ? null : { trigger: "level-up", min_level: null, region },
  };
}

describe("addFormEdges - edge with region: null passes through unchanged", () => {
  it("emits only the default edge when region is null", () => {
    const nodes: ChainNode[] = [
      node(1, null, null),    // root
      node(2, 1, null),       // default edge
    ];
    const result = addFormEdges(nodes, testLookup);
    expect(result).toHaveLength(2);
    expect(result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`)).toEqual([
      "null>>>1",
      "1>>>2",
    ]);
  });
});

describe("addFormEdges - Pikachu chain with Alolan Raichu", () => {
  // Models the PokéAPI chain: Pichu(172) → Pikachu(25) → Raichu(26) where
  // the Pikachu→Raichu step has two evolves_to entries:
  //   - Raichu(26) with region: null  (default)
  //   - Raichu(26) with region: alola (Alolan Raichu)
  // flattenChain produces one node per evolves_to entry, so we get two
  // nodes with speciesId=26 but different region tags.
  //
  // Note: the brief describes this as "Pichu → Alolan Raichu (172, 10100)"
  // but the actual edge is Pikachu(25) → Alolan Raichu(10100).
  const pikachuChainNodes: ChainNode[] = [
    node(172, null, null),   // Pichu root
    node(25, 172, null),     // Pikachu (default)
    node(26, 25, null),      // Raichu default path
    node(26, 25, "alola"),   // Raichu alola path - same speciesId, different region
  ];

  it("emits the default edge 25→26", () => {
    const result = addFormEdges(pikachuChainNodes, testLookup);
    const keys = result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`);
    expect(keys).toContain("25>>>26");
  });

  it("emits the form-aware edge 25→10100 (Pikachu → Alolan Raichu)", () => {
    const result = addFormEdges(pikachuChainNodes, testLookup);
    const keys = result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`);
    expect(keys).toContain("25>>>10100");
  });

  it("emits exactly 4 nodes total (root + 3 edge nodes)", () => {
    const result = addFormEdges(pikachuChainNodes, testLookup);
    // root(172), default Pikachu, default Raichu, form Raichu
    expect(result).toHaveLength(4);
  });

  it("strips the region field from the emitted form-aware node's detail", () => {
    const result = addFormEdges(pikachuChainNodes, testLookup);
    const formNode = result.find(n => n.speciesId === 10100);
    expect(formNode).toBeDefined();
    expect((formNode!.detail as Record<string, unknown>).region).toBeUndefined();
  });
});

describe("addFormEdges - Hisuian Typhlosion chain", () => {
  // Models the PokéAPI chain: Cyndaquil(155) → Quilava(156) → Typhlosion(157).
  // Both the Quilava and Typhlosion nodes appear twice in evolves_to:
  // once with region:null and once with region:hisui.
  // flattenChain produces 4 edge-bearing nodes (2 default, 2 hisui-tagged).
  // addFormEdges turns each hisui-tagged node into a form-aware edge,
  // yielding 2 default + 2 form-aware edges (plus the root = 5 nodes total).
  const cyndaquilChainNodes: ChainNode[] = [
    node(155, null, null),    // Cyndaquil root
    node(156, 155, null),     // Quilava default
    node(157, 156, null),     // Typhlosion default
    node(156, 155, "hisui"),  // Quilava hisui - same speciesId as default
    node(157, 156, "hisui"),  // Typhlosion hisui - same speciesId as default
  ];

  it("emits the two default edges (155→156, 156→157)", () => {
    const result = addFormEdges(cyndaquilChainNodes, testLookup);
    const keys = result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`);
    expect(keys).toContain("155>>>156");
    expect(keys).toContain("156>>>157");
  });

  it("emits the form edge 10229→10230 (Hisuian Cyndaquil → Hisuian Quilava)", () => {
    const result = addFormEdges(cyndaquilChainNodes, testLookup);
    const keys = result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`);
    expect(keys).toContain("10229>>>10230");
  });

  it("emits the form edge 10230→10231 (Hisuian Quilava → Hisuian Typhlosion)", () => {
    const result = addFormEdges(cyndaquilChainNodes, testLookup);
    const keys = result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`);
    expect(keys).toContain("10230>>>10231");
  });

  it("emits 5 nodes total: root + 2 default edges + 2 form-aware edges", () => {
    const result = addFormEdges(cyndaquilChainNodes, testLookup);
    expect(result).toHaveLength(5);
  });

  it("all 5 node keys are distinct", () => {
    const result = addFormEdges(cyndaquilChainNodes, testLookup);
    const keys = result.map(n => `${n.evolvesFromId}>>>${n.speciesId}`);
    expect(new Set(keys).size).toBe(5);
  });
});

describe("addFormEdges - Eevee branching (no regional variants)", () => {
  // Eevee(133) evolves into 8 eeveelutions, none of which have regional variants.
  // All edges have region: null → no form edges emitted.
  const eeveeChainNodes: ChainNode[] = [
    node(133, null, null),  // Eevee root
    node(134, 133, null),   // Vaporeon
    node(135, 133, null),   // Jolteon
    node(136, 133, null),   // Flareon
    node(196, 133, null),   // Espeon
    node(197, 133, null),   // Umbreon
    node(470, 133, null),   // Leafeon
    node(471, 133, null),   // Glaceon
    node(700, 133, null),   // Sylveon
  ];

  it("emits exactly 9 nodes (root + 8 default edges)", () => {
    const result = addFormEdges(eeveeChainNodes, testLookup);
    expect(result).toHaveLength(9);
  });

  it("emits 0 form-aware edges (no regional eeveelution variants)", () => {
    const result = addFormEdges(eeveeChainNodes, testLookup);
    // All speciesIds should be in the original list
    const formIds = result
      .filter(n => n.evolvesFromId !== null)
      .map(n => n.speciesId)
      .filter(id => id > 10000);
    expect(formIds).toHaveLength(0);
  });

  it("emits exactly 8 distinct edges", () => {
    const result = addFormEdges(eeveeChainNodes, testLookup);
    const edges = result.filter(n => n.evolvesFromId !== null);
    expect(edges).toHaveLength(8);
  });
});

describe("addFormEdges - dedup on (evolvesFromId, speciesId)", () => {
  it("collapses duplicate nodes with the same (from, to) pair", () => {
    const nodes: ChainNode[] = [
      node(1, null, null),
      node(2, 1, null),
      node(2, 1, null),  // exact duplicate
    ];
    const result = addFormEdges(nodes, testLookup);
    expect(result).toHaveLength(2); // root + 1 deduplicated edge
  });

  it("does not emit a form edge when the child species has no matching regional variety", () => {
    // Edge with region:hisui but the lookup has no hisui entry for speciesId=999
    const nodes: ChainNode[] = [
      node(998, null, null),
      node(999, 998, "hisui"),
    ];
    const result = addFormEdges(nodes, testLookup);
    // Only default edge 998→999 is emitted (no hisui entry for species 999)
    expect(result).toHaveLength(2);
    expect(result.find(n => n.speciesId > 10000)).toBeUndefined();
  });

  it("uses default parent ID when parent has no matching regional variety", () => {
    // Pikachu(25)→Raichu(26) with region:alola: Pikachu has no Alolan variant,
    // so the form edge uses Pikachu(25) as parent and Alolan Raichu(10100) as child.
    const nodes: ChainNode[] = [
      node(25, null, null),
      node(26, 25, "alola"),
    ];
    const result = addFormEdges(nodes, testLookup);
    const formEdge = result.find(n => n.speciesId === 10100);
    expect(formEdge).toBeDefined();
    expect(formEdge!.evolvesFromId).toBe(25); // Pikachu, not a form ID
  });
});
