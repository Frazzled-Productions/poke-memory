import { describe, it, expect } from "vitest";
import {
  isStubEntry,
  isWorthLearning,
  formCategoryFor,
  slugToDisplayName,
} from "./forms";

// ---------------------------------------------------------------------------
// Fixtures — representative PokéAPI shapes (trimmed to relevant fields)
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
 * Vivillon-Meadow: cosmetic variant — does not appear in varieties[] at all
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
 * Stub Mega (e.g. IDs 10278+) — fan-wiki entry with no real game data.
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

  it("returns false when base_experience is 0 (edge case — some baby Pokémon)", () => {
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

  it("Vivillon-Meadow: is_default=true means form_name may differ — included if non-empty & non-battle-only", () => {
    // Cosmetic pattern forms don't appear in varieties[] in practice; this
    // test documents that the filter alone doesn't exclude Vivillon-Meadow —
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
