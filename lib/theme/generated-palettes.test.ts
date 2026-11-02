import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import generated from "./generated-palettes.json";
import { TYPE_PALETTES } from "./type-palettes";
import { paletteFor, type GeneratedPaletteEntry } from "./palette";
import { CURATED_POKEMON } from "./curated-pokemon";
import {
  DARK_BACKGROUND,
  LIGHT_BACKGROUND,
  passesPaletteChecks,
} from "./contrast";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { POKEMON_TYPES } from "@/lib/pokemon/types";

const ENTRIES = generated as unknown as Readonly<Record<string, GeneratedPaletteEntry>>;
const SPECIES = SEED_POKEMON.filter((p) => p.isDefaultForm);

// Coverage and contrast guard for the committed palettes (#2187). Re-run
// `npm run seed:palettes` after a reseed or a contrast change.
describe("generated-palettes.json coverage and contrast", () => {
  it("Coverage test: every seed species has an entry", () => {
    const missing = SPECIES.filter((p) => ENTRIES[String(p.id)] === undefined).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it("every extracted palette passes the contrast checks", () => {
    const failing = Object.entries(ENTRIES)
      .filter(([, e]) => typeof e !== "string")
      .filter(([, e]) => {
        if ((e as readonly string[]).length !== 4) return true;
        const [primary, secondary, accent, fgOnPrimary] = e as readonly string[];
        return !passesPaletteChecks({ primary, secondary, accent, fgOnPrimary });
      })
      .map(([id]) => id);
    expect(failing).toEqual([]);
  });

  it("every fallback names the species' primary type", () => {
    const wrong = SPECIES.filter((p) => {
      const e = ENTRIES[String(p.id)];
      return typeof e === "string" && e !== p.types[0];
    }).map((p) => p.id);
    expect(wrong).toEqual([]);
  });

  it("every species resolves to a palette, and every non-curated one passes the checks", () => {
    const curatedIds = new Set(CURATED_POKEMON.map((p) => p.id));
    const bad = SPECIES.filter((p) => {
      const palette = paletteFor(p.id);
      if (palette === null) return true;
      return !curatedIds.has(p.id) && !passesPaletteChecks(palette);
    }).map((p) => p.id);
    expect(bad).toEqual([]);
  });
});

describe("type palettes", () => {
  it("there is one palette for each of the 18 types", () => {
    expect(Object.keys(TYPE_PALETTES).sort()).toEqual([...POKEMON_TYPES].sort());
  });

  it("Type palettes pass: every type palette passes both checks", () => {
    const failing = Object.entries(TYPE_PALETTES)
      .filter(([, p]) => !passesPaletteChecks(p))
      .map(([t]) => t);
    expect(failing).toEqual([]);
  });
});

describe("contrast backgrounds", () => {
  it("match the light and dark --background in app/globals.css", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const backgrounds = [...css.matchAll(/^\s*--background:\s*(#[0-9a-fA-F]{6});/gm)].map((m) => m[1].toLowerCase());
    expect(backgrounds.slice(0, 2)).toEqual([LIGHT_BACKGROUND, DARK_BACKGROUND]);
  });
});
