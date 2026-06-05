/**
 * Lightweight localStorage cache for per-locale mastered-species counts.
 *
 * Shape: `{ en: number, ja: number, "zh-Hans": number, "zh-Hant": number }`
 * stored under `KEY_MASTERED_COUNT_BY_LOCALE`.
 *
 * Written by `ReviewSession` after each grade that changes mastery state.
 * Read by `useProfileStatus` to surface the glanceable mastery count without
 * parsing the full ~1025-card array on every page (#1234 perf concern).
 *
 * This is local-only derived state, recomputable from the card array.
 * No migration, no sync leg required.
 *
 * @see KEY_MASTERED_COUNT_BY_LOCALE
 */

import type { AppLocale } from "@/i18n/locales";
import { KEY_MASTERED_COUNT_BY_LOCALE } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

/** Per-locale mastered count object stored in localStorage. */
export type MasteredCountByLocale = {
  en: number;
  ja: number;
  "zh-Hans": number;
  "zh-Hant": number;
};

const EMPTY_COUNTS: MasteredCountByLocale = {
  en: 0,
  ja: 0,
  "zh-Hans": 0,
  "zh-Hant": 0,
};

/**
 * Read the cached per-locale mastered counts from localStorage.
 * Returns `{ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 }` when absent or
 * malformed - callers should treat this as "not yet populated" rather than
 * a definitive zero.
 */
export function readMasteredCountCache(): MasteredCountByLocale {
  return readLocalStorage(
    KEY_MASTERED_COUNT_BY_LOCALE,
    (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return EMPTY_COUNTS;
      }
      const obj = parsed as Record<string, unknown>;
      return {
        en: typeof obj["en"] === "number" ? obj["en"] : 0,
        ja: typeof obj["ja"] === "number" ? obj["ja"] : 0,
        "zh-Hans": typeof obj["zh-Hans"] === "number" ? obj["zh-Hans"] : 0,
        "zh-Hant": typeof obj["zh-Hant"] === "number" ? obj["zh-Hant"] : 0,
      };
    },
    EMPTY_COUNTS,
  );
}

/**
 * Write updated mastered counts for a single locale into the cache, preserving
 * all other locale counts. Dispatches a synthetic StorageEvent so same-tab
 * subscribers (`useProfileStatus`) can refresh without a cross-tab event.
 */
export function writeMasteredCountForLocale(
  locale: AppLocale,
  count: number,
): void {
  const current = readMasteredCountCache();
  const next: MasteredCountByLocale = { ...current, [locale]: count };
  writeLocalStorage(KEY_MASTERED_COUNT_BY_LOCALE, next, { notify: true });
}
