function officialArtworkUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

export type SeedPokemon = {
  id: number;        // National PokéDex ID
  name: string;      // Display name, capitalised: "Bulbasaur", "Mr. Mime" etc.
  spriteUrl: string;
};

export const SEED_POKEMON: readonly SeedPokemon[] = [
  { id: 1,  name: "Bulbasaur",  spriteUrl: officialArtworkUrl(1) },
  { id: 2,  name: "Ivysaur",    spriteUrl: officialArtworkUrl(2) },
  { id: 3,  name: "Venusaur",   spriteUrl: officialArtworkUrl(3) },
  { id: 4,  name: "Charmander", spriteUrl: officialArtworkUrl(4) },
  { id: 5,  name: "Charmeleon", spriteUrl: officialArtworkUrl(5) },
  { id: 6,  name: "Charizard",  spriteUrl: officialArtworkUrl(6) },
  { id: 7,  name: "Squirtle",   spriteUrl: officialArtworkUrl(7) },
  { id: 8,  name: "Wartortle",  spriteUrl: officialArtworkUrl(8) },
  { id: 9,  name: "Blastoise",  spriteUrl: officialArtworkUrl(9) },
  { id: 25, name: "Pikachu",    spriteUrl: officialArtworkUrl(25) },
];
