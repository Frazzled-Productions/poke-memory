// Polyfill IndexedDB for the jsdom environment. jsdom does not ship IDB support,
// so component tests that exercise persistence indirectly need this shim.
import "fake-indexeddb/auto";

// Prime the async seed cache so `getSeedIfLoaded()` (and scope.ts helpers
// that read it) return real data in jsdom-project tests without triggering a
// fetch. Importing seed.ts here is fine - test setups are not the client
// bundle, so the JSON cost is acceptable in tests.
import { SEED_POKEMON, SEED_EVOLUTION_CARDS, SEED_REVERSE_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { _primeSeed } from "@/lib/pokemon/seed-async";
_primeSeed({
  seedPokemon: SEED_POKEMON,
  seedEvolutionCards: SEED_EVOLUTION_CARDS,
  seedReverseEvolutionCards: SEED_REVERSE_EVOLUTION_CARDS,
});
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement window.matchMedia. Provide a stub so any component
// that feature-detects reduced-motion (e.g. GradeButtons → triggerHaptic)
// gets a predictable result without throwing. Individual tests may override
// this stub with vi.fn() if they need to control the returned `matches` value.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// jsdom does not implement Element.prototype.scrollIntoView. Provide a no-op
// stub so any component that scrolls a node into view (e.g. HigherOrLowerGame
// scrolling its reveal block on a guess, #1447) does not throw. Individual
// tests may override this with a spy to assert it was called.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

afterEach(() => {
  cleanup();
});
