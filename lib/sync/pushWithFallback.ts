import type { SupabaseClient } from "@supabase/supabase-js";
import { pushSingleCard } from "@/lib/sync/cloud";
import {
  loadPendingQueue,
  savePendingQueue,
  clearPendingQueue,
} from "@/lib/sync/persistence";
import { loadSession } from "@/lib/review/persistence";
import { todayString } from "@/lib/review/session";
import type { ReviewableCard } from "@/lib/review/session";

/**
 * Outcome of a {@link pushWithFallback} run. Callers translate this into
 * their own status writes and UI state - the helper never touches
 * SyncStatus and never sets React state.
 *
 * - `cancelled`       - the caller's `isCancelled()` returned true; no
 *                       further work was done and the caller should skip all
 *                       status writes.
 * - `queue`           - the persisted queue was pushed. `failedCards` holds
 *                       the cards that did not reach the cloud (empty on
 *                       full success). The queue has already been slimmed to
 *                       `failedCards` (or cleared on full success).
 * - `session-skipped` - `failedCardCount === 0` with
 *                       `skipSessionWhenCountZero` set; no push was needed.
 * - `session-empty`   - the session fallback found nothing eligible to push
 *                       (e.g. wiped storage).
 * - `session`         - the session fallback pushed cards; `anyFailed`
 *                       reports whether any card failed.
 */
export type PushWithFallbackOutcome =
  | { kind: "cancelled" }
  | { kind: "queue"; failedCards: ReviewableCard[] }
  | { kind: "session-skipped" }
  | { kind: "session-empty" }
  | { kind: "session"; anyFailed: boolean };

export interface PushWithFallbackOptions {
  /** `SyncStatus.failedCardCount` as read by the caller. */
  failedCardCount: number | null;
  /**
   * When true and the persisted queue is empty, `failedCardCount === 0`
   * short-circuits the session fallback entirely (`session-skipped`).
   * `useOnlineReconnectSync` sets this; `useRetryPush` handles the
   * zero-count case before calling the helper and leaves it false.
   */
  skipSessionWhenCountZero?: boolean;
  /**
   * Extra eligibility predicate applied to session cards on top of the
   * `lastReview !== null` filter (e.g. `isSyncSafe`).
   */
  isCardEligible?: (card: ReviewableCard) => boolean;
  /**
   * Cooperative cancellation probe (e.g. an unmount flag). Checked before
   * the queue push, after the queue push settles (before the queue is
   * slimmed/cleared), and after the session push settles.
   */
  isCancelled?: () => boolean;
}

/**
 * Shared push engine for the two catch-up hooks (`useRetryPush` and
 * `useOnlineReconnectSync`). Pushes the persisted pending queue when it is
 * non-empty, otherwise falls back to the session-card heuristic (#893):
 *
 *   1. Persisted queue present -> push those exact cards (most precise).
 *      On partial success the queue is slimmed to only the failed cards so
 *      the next retry does not re-push cards that already reached the cloud;
 *      on full success the queue is cleared.
 *   2. No queue -> load the session, take reviewed cards (optionally
 *      filtered by `isCardEligible`), and when `failedCardCount > 0` prefer
 *      the cards reviewed today, falling back to all reviewed cards when the
 *      today-filter matches nothing (e.g. the user returns the next day).
 *
 * A settled push counts as failed when the promise rejected or
 * `pushSingleCard` returned `"failed"`. `"rejected"` (23514 regression
 * trigger) is evicted - the cloud row is newer, no point retrying.
 */
export async function pushWithFallback(
  client: SupabaseClient,
  userId: string,
  options: PushWithFallbackOptions,
): Promise<PushWithFallbackOutcome> {
  const {
    failedCardCount,
    skipSessionWhenCountZero = false,
    isCardEligible,
    isCancelled = () => false,
  } = options;

  // Prefer the persisted queue when it is non-empty (#893). It contains the
  // exact set of cards `usePerGradeSync` had not yet delivered, so it is
  // always more precise than the session-card heuristic below.
  const persistedQueue = loadPendingQueue();
  if (persistedQueue.length > 0) {
    if (isCancelled()) return { kind: "cancelled" };

    const results = await Promise.allSettled(
      persistedQueue.map((card) => pushSingleCard(client, userId, card)),
    );

    if (isCancelled()) return { kind: "cancelled" };

    const failedCards = persistedQueue.filter((_, i) => {
      const r = results[i];
      // "rejected" (Promise rejected) or "failed" (tri-state from
      // pushSingleCard) both warrant a retry.
      if (r.status === "rejected") return true;
      if (r.status !== "fulfilled") return false;
      return r.value === "failed";
    });

    if (failedCards.length > 0) {
      // Partial or total failure: persist only the cards that failed
      // (#893 partial-success slimming).
      savePendingQueue(failedCards);
    } else {
      // Full success: clear the queue so stale data does not accumulate.
      clearPendingQueue();
    }

    return { kind: "queue", failedCards };
  }

  if (skipSessionWhenCountZero && failedCardCount === 0) {
    return { kind: "session-skipped" };
  }

  // No persisted queue: fall back to the session-card heuristic.
  const session = await loadSession();
  const allReviewed = (session?.cards ?? []).filter(
    (card) =>
      card.state.lastReview !== null &&
      (isCardEligible ? isCardEligible(card) : true),
  );

  let cardsToRetry = allReviewed;
  if (failedCardCount !== null && failedCardCount > 0) {
    // Positive count: push today's reviewed cards (approximation of the
    // cards the per-grade path failed to deliver). Fall back to all reviewed
    // cards when the today-filter is empty rather than silently declaring
    // success - the failedCardCount > 0 signal means there is still real
    // work to do.
    const today = todayString(new Date());
    const todayOnly = allReviewed.filter(
      (card) => card.state.lastReview === today,
    );
    cardsToRetry = todayOnly.length > 0 ? todayOnly : allReviewed;
  }

  if (cardsToRetry.length === 0) {
    return { kind: "session-empty" };
  }

  const results = await Promise.allSettled(
    cardsToRetry.map((card) => pushSingleCard(client, userId, card)),
  );

  if (isCancelled()) return { kind: "cancelled" };

  const anyFailed = results.some(
    (r) =>
      r.status === "rejected" ||
      (r.status === "fulfilled" && r.value === "failed"),
  );

  return { kind: "session", anyFailed };
}
