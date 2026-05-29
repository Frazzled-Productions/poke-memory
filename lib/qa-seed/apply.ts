/**
 * Thin DOM/IDB write wrapper for QA seed payloads (#1326).
 *
 * This module is the ONLY place allowed to reference DOM/IDB APIs within
 * lib/qa-seed/. The pure scenario builders in scenarios.ts stay clean so they
 * can be imported from build-time Node scripts (e.g. the screenshot script,
 * issue #1296).
 *
 * applyScenario and clearSeed are the two public functions — they write to
 * IndexedDB (falling back to localStorage when IDB is unavailable) and dispatch
 * the synthetic StorageEvent that same-tab subscribers (useLocalStorageKey)
 * need to re-render.
 */

import { saveSession } from "@/lib/review/persistence";
import type { SavedSession } from "@/lib/review/persistence";
import type { ReviewableCard } from "@/lib/review/session";
import { clearLocalProgress } from "@/lib/storage/reset";
import type { ScenarioKey } from "@/lib/qa-seed/scenarios";
import { buildScenario } from "@/lib/qa-seed/scenarios";

/**
 * Apply a named scenario: build the payload and write it into IDB/localStorage.
 * Dispatches the synthetic storage event so the page re-renders with the new state.
 * Returns a promise so the caller can await persistence completion.
 */
export async function applyScenario(key: ScenarioKey): Promise<void> {
  const payload = buildScenario(key);
  // The MinimalCard shapes in lib/qa-seed/scenarios.ts are a strict subset of
  // ReviewableCard — they carry the required state and discriminant fields.
  // saveSession serialises them via serializeCard (which only strips large
  // arrays present on full SeedPokemon cards, not the minimal shapes here)
  // and the persistence layer re-hydrates full card shapes from seed on load.
  // The cast is safe: parseSession validates shape on next loadSession().
  const session: SavedSession = {
    cards: payload.session.cards as unknown as ReviewableCard[],
    limits: payload.session.limits,
  };
  await saveSession(session);
}

/**
 * Clear the seeded state — equivalent to a fresh-visitor session.
 * Wipes the review-session IDB key and dispatches the storage event so the
 * page immediately reflects an empty state.
 */
export async function clearSeed(): Promise<void> {
  await clearLocalProgress();
}
