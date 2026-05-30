/**
 * Applies a QA seed scenario to local storage.
 *
 * Writing is done through the same helpers the app uses (idbSet, saveSettings),
 * so the seeded state is indistinguishable from real progress. The sync
 * write-guard on SuperuserContext ensures cloud writes are suppressed while
 * any superuser flag is on.
 *
 * Callers must guarantee superuser mode is active before calling applySeedScenario.
 */

import { idbSet, idbDelete } from "@/lib/idb/db";
import { KEY_REVIEW_SESSION, KEY_GRADE_LOG, KEY_QA_SEED_ACTIVE } from "@/lib/storage/keys";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { SESSION_CHANGED_EVENT } from "@/lib/review/persistence";
import type { SeedPayload } from "./scenarios";

/**
 * Writes a seed payload to IndexedDB (and settings where requested).
 * Dispatches a synthetic StorageEvent so same-tab subscribers re-read.
 *
 * @param payload - The seed payload to write.
 * @param slug    - The scenario slug to persist as the active seed indicator.
 *                  When provided, written to localStorage under KEY_QA_SEED_ACTIVE
 *                  so the QaSeedSection can restore the active indicator on remount.
 *
 * This is intentionally NOT async-safe to call from multiple tabs at once —
 * it is a developer-only QA tool invoked by an explicit button click.
 */
export async function applySeedScenario(payload: SeedPayload, slug?: string): Promise<void> {
  if (payload.session !== undefined) {
    const json = JSON.stringify(payload.session);
    await idbSet(KEY_REVIEW_SESSION, json);

    // Advance the write-epoch so NavLinks / BottomTabBar can detect the write.
    if (typeof window !== "undefined") {
      try {
        (window as Window & { __pokeMemorySessionWriteEpoch?: number }).__pokeMemorySessionWriteEpoch =
          ((window as Window & { __pokeMemorySessionWriteEpoch?: number }).__pokeMemorySessionWriteEpoch ?? 0) + 1;
      } catch {
        // Non-standard envs.
      }
      try {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: KEY_REVIEW_SESSION,
            storageArea: window.localStorage,
            newValue: null,
          }),
        );
      } catch {
        // Older browsers.
      }
      try {
        window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT));
      } catch {
        // Non-standard envs.
      }
    }
  }

  if (payload.pokemonNameLocale !== null && payload.pokemonNameLocale !== undefined) {
    const settings = loadSettings();
    saveSettings({ ...settings, pokemonNameLocale: payload.pokemonNameLocale });
  }

  // Persist the active scenario slug so the QaSeedSection can restore the
  // indicator on remount (e.g. navigating away and back to Settings).
  if (typeof window !== "undefined" && slug) {
    try {
      window.localStorage.setItem(KEY_QA_SEED_ACTIVE, slug);
    } catch {
      // Private browsing / storage quota — non-fatal for a QA tool.
    }
  }
}

/**
 * Clears seeded QA state — removes the review session and grade log from IDB,
 * dispatches synthetic events so same-tab subscribers notice the cleared state.
 *
 * Settings are NOT cleared (pokemonNameLocale etc.) because the user may want
 * to keep their locale preference. If needed, clear settings manually from
 * the Settings page.
 */
export async function clearSeedScenario(): Promise<void> {
  await Promise.all([
    idbDelete(KEY_REVIEW_SESSION),
    idbDelete(KEY_GRADE_LOG),
  ]);

  // Clear the active-seed indicator and dispatch change events.
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(KEY_QA_SEED_ACTIVE);
    } catch {
      // Non-fatal for a QA tool.
    }
    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEY_REVIEW_SESSION,
          storageArea: window.localStorage,
          newValue: null,
        }),
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEY_GRADE_LOG,
          storageArea: window.localStorage,
          newValue: null,
        }),
      );
    } catch {
      // Older browsers.
    }
    try {
      window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT));
    } catch {
      // Non-standard envs.
    }
  }
}
