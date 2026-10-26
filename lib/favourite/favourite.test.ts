import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/settings/persistence";
import {
  isHearted,
  parseSpeciesId,
  parseSpeciesIdList,
  setFavouritePokemon,
  toggleHeart,
} from "./favourite";

function settingsWith(patch: Partial<UserSettings>): UserSettings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe("setFavouritePokemon", () => {
  it("Favourite before learning it: sets the id and hearts it, theme untouched", () => {
    const next = setFavouritePokemon(DEFAULT_SETTINGS, 1);
    expect(next.favouritePokemonId).toBe(1);
    expect(next.heartedSpeciesIds).toEqual([1]);
    expect(next.favouriteTheme).toBeNull();
  });

  it("Change of favourite: the old favourite stays hearted", () => {
    const gengar = setFavouritePokemon(DEFAULT_SETTINGS, 94);
    const eevee = setFavouritePokemon(gengar, 133);
    expect(eevee.favouritePokemonId).toBe(133);
    expect(eevee.heartedSpeciesIds).toEqual([133, 94]);
  });

  it("moves an already hearted species to the front without repeating it", () => {
    const next = setFavouritePokemon(settingsWith({ heartedSpeciesIds: [25, 94, 143] }), 94);
    expect(next.heartedSpeciesIds).toEqual([94, 25, 143]);
  });

  it("Clear: favourite null, hearts and theme unchanged", () => {
    const theme = { id: 25, name: "Pikachu", colors: { primary: "#000000", secondary: "#000000", accent: "#000000", fgOnPrimary: "#FFFFFF" }, spriteUrl: null };
    const before = settingsWith({ favouritePokemonId: 94, heartedSpeciesIds: [94, 25], favouriteTheme: theme });
    const next = setFavouritePokemon(before, null);
    expect(next.favouritePokemonId).toBeNull();
    expect(next.heartedSpeciesIds).toEqual([94, 25]);
    expect(next.favouriteTheme).toBe(theme);
  });
});

describe("toggleHeart", () => {
  it("Heart and un-heart: adds at the front, then removes", () => {
    const hearted = toggleHeart(settingsWith({ heartedSpeciesIds: [25] }), 143);
    expect(hearted.heartedSpeciesIds).toEqual([143, 25]);
    const unhearted = toggleHeart(hearted, 143);
    expect(unhearted.heartedSpeciesIds).toEqual([25]);
  });

  it("The favourite's heart: toggling it leaves it hearted", () => {
    const before = setFavouritePokemon(DEFAULT_SETTINGS, 94);
    const after = toggleHeart(before, 94);
    expect(after.heartedSpeciesIds).toEqual([94]);
    expect(isHearted(after, 94)).toBe(true);
  });
});

describe("isHearted", () => {
  it("is true for a hearted species and for the favourite", () => {
    const s = settingsWith({ favouritePokemonId: 94, heartedSpeciesIds: [25] });
    expect(isHearted(s, 25)).toBe(true);
    expect(isHearted(s, 94)).toBe(true);
    expect(isHearted(s, 1)).toBe(false);
  });
});

describe("parseSpeciesId / parseSpeciesIdList", () => {
  it("accepts species ids only", () => {
    expect(parseSpeciesId(25)).toBe(25);
    expect(parseSpeciesId(10100)).toBeNull();
    expect(parseSpeciesId("25")).toBeNull();
    expect(parseSpeciesId(null)).toBeNull();
  });

  it("dedupes and filters a list, keeping the first occurrence", () => {
    expect(parseSpeciesIdList([3, 1, 3, "2", 2, 0])).toEqual([3, 1, 2]);
    expect(parseSpeciesIdList(null)).toEqual([]);
  });
});
