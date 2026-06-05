/**
 * Lightweight localStorage cache for per-locale due-today counts (#1484).
 *
 * Shape: `{ en: number, ja: number, "zh-Hans": number, "zh-Hant": number }`
 * stored under `KEY_DUE_COUNT_BY_LOCALE`.
 *
 * Written by `ReviewSession` (which already holds the hydrated card array) after
 * load and after each grade. Read by the `LanguageSwitcher` to show a per-
 * language due badge without re-parsing the full ~1025-card array on every
 * render (#1234 perf concern).
 *
 * Counts DUE REVIEWS only (graduated cards past their due date) - not new cards,
 * which are a setting-driven cap rather than a concrete backlog.
 *
 * Local-only derived state, recomputable from the card array. No migration, no
 * sync leg. Mirrors `lib/profile/masteredCountCache.ts`.
 */

import type { AppLocale } from "@/i18n/locales";
import {
  KEY_DUE_COUNT_BY_LOCALE,
  KEY_HAS_HISTORY_BY_LOCALE,
} from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

/** Per-locale due-today count object stored in localStorage. */
export type DueCountByLocale = {
  en: number;
  ja: number;
  "zh-Hans": number;
  "zh-Hant": number;
};

const EMPTY_COUNTS: DueCountByLocale = {
  en: 0,
  ja: 0,
  "zh-Hans": 0,
  "zh-Hant": 0,
};

/**
 * Read the cached per-locale due counts from localStorage. Returns all-zero
 * when absent or malformed - callers should treat that as "not yet populated".
 */
export function readDueCountCache(): DueCountByLocale {
  return readLocalStorage(
    KEY_DUE_COUNT_BY_LOCALE,
    (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
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
 * Write due counts for one or more locales, merging over the existing cache.
 * One localStorage write + one synthetic StorageEvent so same-tab subscribers
 * (the LanguageSwitcher) refresh after a grade. ReviewSession computes the whole
 * enrolled set in a single card-array pass and writes it here at once.
 */
export function writeDueCounts(partial: Partial<DueCountByLocale>): void {
  const current = readDueCountCache();
  const next: DueCountByLocale = { ...current, ...partial };
  writeLocalStorage(KEY_DUE_COUNT_BY_LOCALE, next, { notify: true });
}

/** Convenience single-locale writer (mirrors the mastered-count cache API). */
export function writeDueCountForLocale(locale: AppLocale, count: number): void {
  writeDueCounts({ [locale]: count });
}

// ─── Has-history cache ────────────────────────────────────────────────────────

/**
 * Per-locale "has review history" flags. `true` means the locale has at least
 * one card with `state.lastReview !== null` - i.e. the user has done at least
 * one review in that language. Used to distinguish "Caught up" from "No cards
 * yet" in the LanguageSwitcher due-badge.
 */
export type HasHistoryByLocale = {
  en: boolean;
  ja: boolean;
  "zh-Hans": boolean;
  "zh-Hant": boolean;
};

const EMPTY_HAS_HISTORY: HasHistoryByLocale = {
  en: false,
  ja: false,
  "zh-Hans": false,
  "zh-Hant": false,
};

/**
 * Read the cached per-locale has-history flags from localStorage. Returns
 * all-false when absent or malformed.
 */
export function readHasHistoryCache(): HasHistoryByLocale {
  return readLocalStorage(
    KEY_HAS_HISTORY_BY_LOCALE,
    (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return EMPTY_HAS_HISTORY;
      }
      const obj = parsed as Record<string, unknown>;
      return {
        en: obj["en"] === true,
        ja: obj["ja"] === true,
        "zh-Hans": obj["zh-Hans"] === true,
        "zh-Hant": obj["zh-Hant"] === true,
      };
    },
    EMPTY_HAS_HISTORY,
  );
}

/**
 * Write has-history flags for all locales at once. One localStorage write +
 * synthetic StorageEvent so same-tab subscribers refresh. ReviewSession
 * computes the whole enrolled set in one pass and writes it together with the
 * due counts.
 */
export function writeHasHistory(flags: HasHistoryByLocale): void {
  writeLocalStorage(KEY_HAS_HISTORY_BY_LOCALE, flags, { notify: true });
}
