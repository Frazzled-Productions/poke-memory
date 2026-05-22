/**
 * Canonical starter Pokémon species id list.
 *
 * One entry per regional starter trio (Gens I–IX). Shared between the
 * client-side scope helper (`lib/review/scope.ts`) and the server-side
 * predicate (`lib/eligibility/scopePredicate.ts`) so the two stay in sync
 * without manual duplication.
 *
 * These ids are stable: they come from the PokéAPI species endpoint and are
 * never reassigned.
 */
export const STARTER_IDS: ReadonlySet<number> = new Set([
  1, 4, 7,       // Gen I  — Bulbasaur, Charmander, Squirtle
  152, 155, 158,  // Gen II — Chikorita, Cyndaquil, Totodile
  252, 255, 258,  // Gen III — Treecko, Torchic, Mudkip
  387, 390, 393,  // Gen IV — Turtwig, Chimchar, Piplup
  495, 498, 501,  // Gen V  — Snivy, Tepig, Oshawott
  650, 653, 656,  // Gen VI — Chespin, Fennekin, Froakie
  722, 725, 728,  // Gen VII — Rowlet, Litten, Popplio
  810, 813, 816,  // Gen VIII — Grookey, Scorbunny, Sobble
  906, 909, 912,  // Gen IX — Sprigatito, Fuecoco, Quaxly
]);
