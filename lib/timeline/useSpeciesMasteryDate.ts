"use client";

import { useEffect, useState } from "react";
import { loadGradeLog, GRADE_LOG_CHANGED_EVENT } from "@/lib/gradelog/persistence";
import { KEY_GRADE_LOG } from "@/lib/storage/keys";
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
 *
 * SSR safety: this module is only ever populated from inside the
 * `useEffect` below, which React never runs during server rendering / RSC
 * prerender - so `cache` is guaranteed to stay `null` on the server and
 * there is no cross-request leak risk despite the module-level `let`. The
 * listener-registration block a few lines down is additionally guarded by
 * `typeof window !== "undefined"` so it never touches a server-side
 * `window` global either.
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

// Invalidate on every write that goes through lib/gradelog/persistence.ts -
// `appendGradeEntry` (a new grade), `removeGradeEntry` (an undo), AND
// `saveGradeLog` (a bulk overwrite: cloud pull/merge in `pullAndMerge.ts`,
// superuser force-pull, post-sign-in merge, manual force-pull). All four fire
// `GRADE_LOG_CHANGED_EVENT` (a custom event, not a native `StorageEvent`,
// because IndexedDB - not localStorage - is the primary store).
//
// Writers that bypass persistence.ts and delete/restore the IDB store
// directly - a guest progress reset or the superuser "reset everywhere" path
// (`lib/storage/reset.ts`), multi-account archive/restore on a device switch
// (`lib/storage/userArchive.ts`), and the QA-seed clear path
// (`lib/qa-seed/apply.ts`) - do not go through `GRADE_LOG_CHANGED_EVENT`.
// They instead dispatch a synthetic `StorageEvent` keyed to `KEY_GRADE_LOG`,
// the same convention `PracticeSidebar` already relies on - so listen for
// that too. Without this leg, a reset ("Mastered around March 2026" on a
// species with no history left) or an account switch would keep serving the
// stale cached Map until a full page reload.
if (typeof window !== "undefined") {
  window.addEventListener(GRADE_LOG_CHANGED_EVENT, () => {
    cache = null;
  });
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === KEY_GRADE_LOG) {
      cache = null;
    }
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
