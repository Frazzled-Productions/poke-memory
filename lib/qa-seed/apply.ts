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
import {
  loadSettings,
  saveSettings,
  type UserSettings,
} from "@/lib/settings/persistence";
import { saveStreakData } from "@/lib/streak/persistence";
import { DEFAULT_STREAK_PROTECTION } from "@/lib/streak/tokens";
import { writeMasteredCountForLocale } from "@/lib/profile/masteredCountCache";
import { SUPPORTED_LOCALES, type AppLocale } from "@/i18n/locales";
import { SESSION_CHANGED_EVENT } from "@/lib/review/persistence";
import type { SeedPayload } from "./scenarios";

/**
 * Expands a count of consecutive review days into the "YYYY-MM-DD" date array
 * ending today (oldest first), matching the StreakData shape. Uses Date.now()
 * because the seeded streak must be anchored to wall-clock today so
 * computeStreak counts it as the user's current streak.
 */
function lastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

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

  // Streak storage (KEY_STREAK) — saveStreakData dispatches STREAK_UPDATED_EVENT
  // so a mounted StreakBadge / ProfileStatusBar re-reads the seeded streak live.
  if (payload.streakDays !== undefined && payload.streakDays > 0) {
    saveStreakData(lastNDates(payload.streakDays));
  }

  // Settings legs (pokemonNameLocale + streakProtection) — merged into a single
  // load/save so we touch localStorage once. saveSettings dispatches
  // SETTINGS_SAVED_EVENT, which the status surfaces also listen to.
  const settingsPatch: Partial<UserSettings> = {};
  if (payload.pokemonNameLocale !== null && payload.pokemonNameLocale !== undefined) {
    settingsPatch.pokemonNameLocale = payload.pokemonNameLocale;
  }
  if (payload.streakProtection !== undefined) {
    settingsPatch.streakProtection = payload.streakProtection;
  }
  if (Object.keys(settingsPatch).length > 0) {
    const settings = loadSettings();
    saveSettings({ ...settings, ...settingsPatch });
  }

  // Warm the mastered-count cache (read by useProfileStatus → ProfileStatusBar)
  // so mastery is correct on non-Practice pages immediately. Otherwise the bar
  // shows 0 mastered until ReviewSession (Practice) warms it. writeMasteredCount
  // ForLocale dispatches a synthetic storage event so the bar refreshes live.
  if (payload.masteredCountByLocale) {
    for (const [locale, count] of Object.entries(payload.masteredCountByLocale)) {
      if (typeof count === "number") {
        writeMasteredCountForLocale(locale as AppLocale, count);
      }
    }
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
 * resets the seeded streak + protection-token state, and dispatches synthetic
 * events so same-tab subscribers notice the cleared state.
 *
 * The locale preference (pokemonNameLocale) is NOT cleared — the user may want
 * to keep it. The streak and streakProtection ARE reset, because a scenario
 * seeds them (so leaving them behind would show a phantom streak/token balance
 * on the now-empty status bar). This mirrors the apply step.
 */
export async function clearSeedScenario(): Promise<void> {
  await Promise.all([
    idbDelete(KEY_REVIEW_SESSION),
    idbDelete(KEY_GRADE_LOG),
  ]);

  // Reset the seeded streak + protection tokens (dispatches STREAK_UPDATED_EVENT
  // and SETTINGS_SAVED_EVENT so the status bar empties live). Locale is left as-is.
  saveStreakData([]);
  const settings = loadSettings();
  saveSettings({ ...settings, streakProtection: { ...DEFAULT_STREAK_PROTECTION } });

  // Reset the seeded mastered-count cache so the bar's mastery returns to 0.
  for (const locale of SUPPORTED_LOCALES) {
    writeMasteredCountForLocale(locale, 0);
  }

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
