import type { SeedPokemon } from "@/lib/pokemon/seed";
import type { StoredFavouriteTheme } from "@/lib/settings/persistence";

/**
 * The stored theme for a species (#2187): the same `{ id, name, colors,
 * spriteUrl }` shape as before, `name` the English seed name and `colors`
 * its palette (`paletteFor`). The palettes module is loaded on demand so its
 * JSON stays out of the chunks that import this. Null for an id with no
 * palette.
 */
export async function themeForSpecies(
  pokemon: Pick<SeedPokemon, "id" | "name" | "spriteUrl">,
): Promise<StoredFavouriteTheme | null> {
  const { paletteFor } = await import("./palette");
  const colors = paletteFor(pokemon.id);
  if (colors === null) return null;
  return { id: pokemon.id, name: pokemon.name, colors, spriteUrl: pokemon.spriteUrl };
}
