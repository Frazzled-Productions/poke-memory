/**
 * Cross-component "review session active" reference count.
 *
 * Shared signal so background side-effects can avoid yanking state from under
 * an in-progress review:
 *
 * - `useVisibilityPull` skips `pullAndMerge` while a session is mounted — a
 *   pull mid-session can move card progress and force a reload via
 *   `SYNC_PULL_APPLIED_EVENT` (#1163).
 * - `ServiceWorkerProvider` skips the silent SKIP_WAITING activator while a
 *   session is mounted, so a freshly waiting worker waits for a quieter
 *   moment (#1162).
 *
 * The producer is `ReviewSession`: it increments the count on mount and
 * decrements it on unmount. localStorage is used (not in-memory state) so
 * consumers outside the React tree — service-worker visibility handler,
 * top-level sync hooks — can read it without prop drilling.
 *
 * **Reference-count design (#1178).** The original implementation stored a
 * boolean, which broke when two `/practice` tabs were open: closing Tab A
 * called `markSessionInactive()` and cleared the flag, leaving Tab B
 * unprotected. Storing an integer count fixes the close-one-of-two case.
 * `markSessionActive()` increments, `markSessionInactive()` decrements
 * (clamped at 0), `isSessionActive()` returns `count > 0`.
 *
 * **Legacy / corrupt value handling.** The old boolean-string format stored
 * `"1"` when active and removed the key when inactive. `parseInt("1", 10)`
 * is 1, which is correctly treated as "one session active". Any value that
 * `parseInt` cannot parse (e.g. `"true"`, `"false"`, `""`) returns `NaN`,
 * which is treated as 0 — safe, erring on the side of allowing background
 * work rather than permanently blocking it.
 *
 * SSR-safe: every helper guards against `window` being undefined, so
 * importing this module from a server component never throws.
 */

import { KEY_REVIEW_SESSION_ACTIVE } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorageRaw } from "@/lib/storage/writeLocalStorage";

/** Read the current raw count from storage, defaulting to 0 on any error. */
function readCount(): number {
  return readLocalStorage(
    KEY_REVIEW_SESSION_ACTIVE,
    (raw) => {
      const n = parseInt(raw, 10);
      // NaN (unparseable legacy or corrupt value) → treat as 0
      return Number.isNaN(n) ? 0 : n;
    },
    0,
  );
}

/** Write a count to storage, swallowing errors (best-effort). */
function writeCount(n: number): void {
  if (n <= 0) {
    try {
      window.localStorage.removeItem(KEY_REVIEW_SESSION_ACTIVE);
    } catch {
      // best-effort; see module doc
    }
  } else {
    // Store as a raw decimal string (not JSON-encoded).
    writeLocalStorageRaw(KEY_REVIEW_SESSION_ACTIVE, String(n));
  }
}

/**
 * Increment the active-session count. Call on `ReviewSession` mount.
 *
 * Persistence errors (quota exceeded, storage disabled, private-mode quirks)
 * are swallowed. A missed write only means the gates fall back to their
 * old behaviour (pull / activate); user data is not affected.
 */
export function markSessionActive(): void {
  if (typeof window === "undefined") return;
  writeCount(readCount() + 1);
}

/**
 * Decrement the active-session count. Call on `ReviewSession` unmount.
 *
 * Clamped at 0 — the count never goes negative. Safe to call when the flag
 * was never set.
 */
export function markSessionInactive(): void {
  if (typeof window === "undefined") return;
  writeCount(Math.max(0, readCount() - 1));
}

/**
 * Returns `true` when at least one review session is currently mounted.
 *
 * SSR returns `false` — there is no review session on the server.
 */
export function isSessionActive(): boolean {
  if (typeof window === "undefined") return false;
  return readCount() > 0;
}
