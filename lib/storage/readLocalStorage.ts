/**
 * Shared localStorage read-with-fallback utility.
 *
 * Encapsulates the repeated pattern across persistence modules:
 *
 *   if (typeof window === 'undefined') return fallback;
 *   try {
 *     const raw = window.localStorage.getItem(key);
 *     if (raw === null) return fallback;
 *     return parse(raw);
 *   } catch { return fallback; }
 *
 * Notes:
 *   - The `parse` function is called only when `raw` is a non-null string.
 *     If `parse` throws (e.g. malformed JSON) the catch returns `fallback`.
 *   - This helper is intentionally kept pure - no IDB awareness. Modules that
 *     use IDB as the primary store (review session, grade log) call this only
 *     from their localStorage fallback path; they should not use it on the
 *     IDB-primary path.
 *   - Both `window.localStorage` and the global `localStorage` alias work:
 *     callers can use either because the guard is on `typeof window`, not on
 *     the `localStorage` global. The helper uses `window.localStorage` so it
 *     works in any environment where `window` is defined.
 */
export function readLocalStorage<T>(
  key: string,
  parse: (raw: string) => T,
  fallback: T,
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw);
  } catch {
    return fallback;
  }
}
