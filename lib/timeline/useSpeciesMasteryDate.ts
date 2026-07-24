"use client";

import { useEffect, useState } from "react";
import { loadGradeLog, GRADE_LOG_APPENDED_EVENT } from "@/lib/gradelog/persistence";
import { buildSpeciesMasteryDates } from "@/lib/timeline/reconstruct";
import type { AppLocale } from "@/i18n/locales";

/**
 * Module-scope cache for the per-species mastery-date map (#1956).
 *
 * The underlying replay walks the ENTIRE grade log, so it must be computed
 * ONCE per (locale, forceAllMastered) combination and shared across every
 * Pokédex detail-page mount - not re-run per species and not re-run per
 * render. Keyed only by locale + forceAllMastered (not speciesId): every
 * species page looks up its own entry in the same shared Map.
 */
let cache: {
  key: string;
  promise: Promise<Map<number, string>>;
} | null = null;

function cacheKey(locale: AppLocale, forceAllMastered: boolean): string {
  return `${locale}:${forceAllMastered}`;
}

function loadSpeciesMasteryDates(
  locale: AppLocale,
  forceAllMastered: boolean,
): Promise<Map<number, string>> {
  const key = cacheKey(locale, forceAllMastered);
  if (cache !== null && cache.key === key) return cache.promise;

  const promise = (async () => {
    const log = await loadGradeLog();
    return buildSpeciesMasteryDates({ log, locale, forceAllMastered });
  })();
  cache = { key, promise };
  return promise;
}

// Grade-log writes (`appendGradeEntry`) fire this custom event rather than a
// native `StorageEvent` (IndexedDB is the primary store, not localStorage),
// so invalidate the cache on it directly instead of via `useLocalStorageKey`.
// A fresh grade recorded elsewhere (e.g. the practice page in another tab, or
// after navigating back from a session) must not serve a stale replay.
if (typeof window !== "undefined") {
  window.addEventListener(GRADE_LOG_APPENDED_EVENT, () => {
    cache = null;
  });
}

/**
 * Look up the approximate mastery-crossing date (a "YYYY-MM-DD" UTC string)
 * for one species, from the single shared FSRS replay described above
 * (#1956). Render this at MONTH granularity only (`formatMonthYear`) - see
 * the accuracy bar documented on `buildSpeciesMasteryDates`.
 *
 * Returns null:
 *   - while the replay is loading
 *   - when the species has no recoverable crossing (never mastered in the
 *     log, or the log has been pruned past the guest 365-day window)
 *   - when `forceAllMastered` (superuser pretend-all-mastered) is on - the
 *     flag fakes CURRENT mastery without a real crossing to report
 *
 * Callers must fall back to the existing date-less "Mastered" badge in every
 * one of those cases - never fabricate or guess a date.
 */
export function useSpeciesMasteryDate(
  speciesId: number,
  locale: AppLocale,
  forceAllMastered: boolean,
): string | null {
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSpeciesMasteryDates(locale, forceAllMastered).then((map) => {
      if (!cancelled) setDate(map.get(speciesId) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [speciesId, locale, forceAllMastered]);

  return date;
}
