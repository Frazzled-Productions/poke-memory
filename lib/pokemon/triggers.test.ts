import { describe, it, expect } from "vitest";
import { triggerPhrase, type EvolutionDetail } from "./triggers";

function detail(partial: Partial<EvolutionDetail> & { trigger: string }): EvolutionDetail {
  return {
    min_level: null,
    min_happiness: null,
    min_affection: null,
    min_beauty: null,
    min_move_count: null,
    min_steps: null,
    min_damage_taken: null,
    time_of_day: null,
    location: null,
    known_move: null,
    known_move_type: null,
    held_item: null,
    needs_overworld_rain: false,
    turn_upside_down: false,
    relative_physical_stats: null,
    gender: null,
    party_species: null,
    party_type: null,
    item: null,
    trade_species: null,
    used_move: null,
    ...partial,
  };
}

describe("triggerPhrase", () => {
  it("returns null for null input", () => {
    expect(triggerPhrase(null)).toBeNull();
  });

  describe("level-up", () => {
    it("min_level alone — Bulbasaur → Ivysaur", () => {
      expect(triggerPhrase(detail({ trigger: "level-up", min_level: 16 })))
        .toBe("at level 16");
    });

    it("no min_level (e.g. shed prelude in PokéAPI)", () => {
      expect(triggerPhrase(detail({ trigger: "level-up" })))
        .toBe("at any level");
    });

    it("min_happiness alone — Pichu → Pikachu", () => {
      expect(triggerPhrase(detail({ trigger: "level-up", min_happiness: 220 })))
        .toBe("with high friendship");
    });

    it("min_happiness + time_of_day=day — Eevee → Espeon", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_happiness: 220,
        time_of_day: "day",
      }))).toBe("with high friendship during the day");
    });

    it("min_happiness + time_of_day=night — Eevee → Umbreon", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_happiness: 220,
        time_of_day: "night",
      }))).toBe("with high friendship at night");
    });

    it("min_affection + known_move_type — Eevee → Sylveon", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_affection: 3,
        known_move_type: "fairy",
      }))).toBe("with high affection knowing a Fairy move");
    });

    it("min_beauty — Feebas → Milotic", () => {
      expect(triggerPhrase(detail({ trigger: "level-up", min_beauty: 170 })))
        .toBe("with maxed beauty");
    });

    it("min_level + time_of_day=night — Sneasel → Weavile (when no held item)", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 25,
        time_of_day: "night",
      }))).toBe("at level 25 at night");
    });

    it("min_level + held_item + time_of_day — actual Sneasel → Weavile shape", () => {
      // PokéAPI sets min_level=null on this edge; held_item + time_of_day drive it.
      expect(triggerPhrase(detail({
        trigger: "level-up",
        held_item: "razors-claw",
        time_of_day: "night",
      }))).toBe("at any level at night while holding a Razors Claw");
    });

    it("location — Eevee → Leafeon", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        location: "eterna-forest",
      }))).toBe("at any level near Eterna Forest");
    });

    it("known_move — Bonsly → Sudowoodo", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        known_move: "mimic",
      }))).toBe("at any level while knowing Mimic");
    });

    it("needs_overworld_rain — Sliggoo → Goodra", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 50,
        needs_overworld_rain: true,
      }))).toBe("at level 50 in the rain");
    });

    it("turn_upside_down — Inkay → Malamar", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 30,
        turn_upside_down: true,
      }))).toBe("at level 30 held upside-down");
    });

    it("relative_physical_stats=1 — Tyrogue → Hitmonlee", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 20,
        relative_physical_stats: 1,
      }))).toBe("at level 20 with Attack > Defense");
    });

    it("relative_physical_stats=-1 — Tyrogue → Hitmonchan", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 20,
        relative_physical_stats: -1,
      }))).toBe("at level 20 with Defense > Attack");
    });

    it("relative_physical_stats=0 — Tyrogue → Hitmontop", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 20,
        relative_physical_stats: 0,
      }))).toBe("at level 20 with Attack = Defense");
    });

    it("gender=1 (female) — Burmy → Wormadam", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 20,
        gender: 1,
      }))).toBe("at level 20 (female)");
    });

    it("gender=2 (male) — Burmy → Mothim", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 20,
        gender: 2,
      }))).toBe("at level 20 (male)");
    });

    it("party_species — Mantyke → Mantine", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        party_species: "remoraid",
      }))).toBe("at any level with a Remoraid in the party");
    });

    it("party_type — Pancham → Pangoro", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_level: 32,
        party_type: "dark",
      }))).toBe("at level 32 with a Dark-type in the party");
    });

    it("min_steps — Pawmo → Pawmot", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_steps: 1000,
      }))).toBe("after walking 1000 steps with it in the party");
    });

    it("min_damage_taken on level-up — Yamask-Galar → Runerigus", () => {
      expect(triggerPhrase(detail({
        trigger: "level-up",
        min_damage_taken: 49,
      }))).toBe("after taking 49+ damage in one battle");
    });
  });

  describe("use-item", () => {
    it("item — Eevee → Vaporeon (water-stone)", () => {
      expect(triggerPhrase(detail({ trigger: "use-item", item: "water-stone" })))
        .toBe("using a Water Stone");
    });

    it("item — Eevee → Jolteon (thunder-stone)", () => {
      expect(triggerPhrase(detail({ trigger: "use-item", item: "thunder-stone" })))
        .toBe("using a Thunder Stone");
    });

    it("returns null when item missing", () => {
      expect(triggerPhrase(detail({ trigger: "use-item" }))).toBeNull();
    });
  });

  describe("trade", () => {
    it("bare trade — Kadabra → Alakazam", () => {
      expect(triggerPhrase(detail({ trigger: "trade" }))).toBe("by trading it");
    });

    it("held_item — Slowpoke → Slowking", () => {
      expect(triggerPhrase(detail({ trigger: "trade", held_item: "kings-rock" })))
        .toBe("by trading it while holding a Kings Rock");
    });

    it("trade_species — Karrablast → Escavalier", () => {
      expect(triggerPhrase(detail({ trigger: "trade", trade_species: "shelmet" })))
        .toBe("by trading it for a Shelmet");
    });
  });

  describe("one-off triggers", () => {
    it("shed — Nincada → Shedinja", () => {
      expect(triggerPhrase(detail({ trigger: "shed" })))
        .toBe("with a spare Poké Ball and party slot at level 20");
    });

    it("three-critical-hits — Farfetch'd-Galar → Sirfetch'd", () => {
      expect(triggerPhrase(detail({ trigger: "three-critical-hits" })))
        .toBe("by landing three critical hits in one battle");
    });

    it("tower-of-darkness — Kubfu → Urshifu Single-Strike", () => {
      expect(triggerPhrase(detail({ trigger: "tower-of-darkness" })))
        .toBe("by completing the Tower of Darkness");
    });

    it("tower-of-waters — Kubfu → Urshifu Rapid-Strike", () => {
      expect(triggerPhrase(detail({ trigger: "tower-of-waters" })))
        .toBe("by completing the Tower of Waters");
    });

    it("agile-style-move — Stantler → Wyrdeer", () => {
      expect(triggerPhrase(detail({
        trigger: "agile-style-move",
        used_move: "psyshield-bash",
        min_move_count: 20,
      }))).toBe("by using Psyshield Bash in the agile style 20 times");
    });

    it("strong-style-move — Qwilfish-Hisui → Overqwil", () => {
      expect(triggerPhrase(detail({
        trigger: "strong-style-move",
        used_move: "barb-barrage",
        min_move_count: 20,
      }))).toBe("by using Barb Barrage in the strong style 20 times");
    });

    it("recoil-damage — Basculin-WhiteStriped → Basculegion", () => {
      expect(triggerPhrase(detail({
        trigger: "recoil-damage",
        min_damage_taken: 294,
      }))).toBe("after taking 294+ recoil damage in one battle");
    });

    it("three-defeated-bisharp — Bisharp → Kingambit", () => {
      expect(triggerPhrase(detail({ trigger: "three-defeated-bisharp" })))
        .toBe("by defeating three Bisharp while holding a Leader's Crest");
    });

    it("gimmighoul-coins — Gimmighoul → Gholdengo", () => {
      expect(triggerPhrase(detail({ trigger: "gimmighoul-coins" })))
        .toBe("by collecting 999 Gimmighoul Coins");
    });

    it("spin — Milcery → Alcremie", () => {
      expect(triggerPhrase(detail({ trigger: "spin" })))
        .toBe("by spinning while holding a Sweet");
    });

    it("use-move — Primeape → Annihilape", () => {
      expect(triggerPhrase(detail({ trigger: "use-move", used_move: "rage-fist" })))
        .toBe("by using Rage Fist repeatedly");
    });

    it("other returns null", () => {
      expect(triggerPhrase(detail({ trigger: "other" }))).toBeNull();
    });

    it("unknown trigger returns null", () => {
      expect(triggerPhrase(detail({ trigger: "fictional-trigger" }))).toBeNull();
    });
  });
});
