/**
 * Cross-component "review session active" flag.
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
 * The producer is `ReviewSession`: it sets the flag on mount and clears it
 * on unmount. localStorage is used (not in-memory state) so consumers
 * outside the React tree — service-worker visibility handler, top-level
 * sync hooks — can read it without prop drilling. The flag is intentionally
 * not versioned; its lifecycle is bounded by the session mount.
 *
 * SSR-safe: every helper guards against `window` being undefined, so
 * importing this module from a server component never throws.
 */

import { KEY_REVIEW_SESSION_ACTIVE } from "@/lib/storage/keys";

const ACTIVE_VALUE = "1";

/**
 * Mark a review session as active. Idempotent.
 *
 * Persistence errors (quota exceeded, storage disabled, private-mode quirks)
 * are swallowed. A missed flag write only means the gates fall back to their
 * old behaviour (pull / activate); user data is not affected.
 */
export function markSessionActive(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_REVIEW_SESSION_ACTIVE, ACTIVE_VALUE);
  } catch {
    // best-effort; see module doc
  }
}

/**
 * Clear the active-session flag. Safe to call when the flag was never set.
 */
export function markSessionInactive(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY_REVIEW_SESSION_ACTIVE);
  } catch {
    // best-effort; see module doc
  }
}

/**
 * Returns true when a review session is currently mounted.
 *
 * SSR returns false — there is no review session on the server.
 */
export function isSessionActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY_REVIEW_SESSION_ACTIVE) === ACTIVE_VALUE;
  } catch {
    return false;
  }
}
