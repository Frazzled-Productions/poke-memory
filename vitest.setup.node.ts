// Polyfill IndexedDB for the node environment (no DOM).
// fake-indexeddb/auto installs FDBFactory, FDBDatabase, etc. on globalThis
// so idb and lib/idb/db.ts can open and query IndexedDB in vitest node tests.
import "fake-indexeddb/auto";

// Prime the async seed cache so `getSeedIfLoaded()` (and scope.ts helpers
// that read it) return real data in node-project tests without triggering a
// fetch. Importing seed.ts here is fine - test setups are not the client
// bundle, so the JSON cost is acceptable in tests.
import { SEED_POKEMON, SEED_EVOLUTION_CARDS, SEED_REVERSE_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { _primeSeed } from "@/lib/pokemon/seed-async";
_primeSeed({
  seedPokemon: SEED_POKEMON,
  seedEvolutionCards: SEED_EVOLUTION_CARDS,
  seedReverseEvolutionCards: SEED_REVERSE_EVOLUTION_CARDS,
});
