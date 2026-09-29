"use client";
import { useCallback, useEffect, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushSingleCard, isSyncSafe, type PushSingleCardResult } from "@/lib/sync/cloud";
import {
  markPushSucceeded,
  markPushFailed,
  loadSyncStatus,
  loadPendingQueue,
  savePendingQueue,
  clearPendingQueue,
} from "@/lib/sync/persistence";
import {
  hasStructuralProbeBeenAttempted,
  markStructuralProbeAttempted,
} from "@/lib/sync/structuralError";
import { useLatestRef } from "@/lib/hooks/useLatestRef";
import { registerBackgroundSync } from "@/lib/sync/backgroundSync";
import { releaseCloudPushHold, type GradeLogEntry } from "@/lib/gradelog/persistence";
import { pushGradeLogEntry } from "@/lib/sync/gradeLogPush";

/** Number of consecutive all-failure drains before the banner is shown. */
const FAILURE_THRESHOLD = 3;

/**
 * How long the tab may stay hidden before an undoable grade is committed to
 * the cloud and its undo expires (#2052). Short enough that a backgrounded
 * mobile tab still syncs, long enough that a quick app switch keeps undo.
 */
export const UNDO_HOLD_HIDDEN_GRACE_MS = 30_000;

/**
 * Upper bound on how long a grade can be held while the tab stays visible
 * and idle (#2052). After this the grade is committed and undo expires, so an
 * abandoned-but-open session cannot hold a grade off the cloud indefinitely.
 */
export const UNDO_HOLD_MAX_MS = 300_000;

/**
 * What the unload safety-net sends: the unsynced cards plus the grade-log
 * entries of a just-committed held grade (the beacon carries both, #2052).
 * `heldCards` are cards still inside their undo window: NOT sent, but the
 * caller must keep them in the local pending queue (durability) rather than
 * overwrite or clear the persisted copy.
 */
export type UnsyncedSnapshot = {
  cards: ReviewableCard[];
  gradeLog: GradeLogEntry[];
  heldCards: ReviewableCard[];
};

/** Slot for the single grade the user can still undo (#2052). */
type HeldGrade = {
  token: number;
  /** null for an in-step grade (not sync-safe): only its grade-log leg is held. */
  card: ReviewableCard | null;
  gradeLog: GradeLogEntry | null;
};

/** Locale-aware queue key (#1259). */
const cardLocaleKey = (card: ReviewableCard) => `${card.id}:${card.locale ?? "en"}`;

/** Debounce delay (ms) for writing the pending queue to localStorage (#893). */
const PERSIST_DEBOUNCE_MS = 500;

// Session-scoped self-heal probe guard lives in structuralError.ts and is
// accessed via hasStructuralProbeBeenAttempted / markStructuralProbeAttempted.
// See structuralError.ts JSDoc for the full rationale (#1358 FIX 3).

/**
 * Debounced per-grade sync hook. Returns { enqueueGrade, attachHeldGradeLog,
 * discardHeld, flushPending }.
 *
 * enqueueGrade(card) - fire-and-forget. Adds the card to the pending queue
 * and arms a 200 ms debounce. When the timer fires, all queued cards are
 * upserted one at a time; successes are drained, failures stay queued for
 * the next grade or the unload safety-net.
 *
 * flushPending(final?) - returns a snapshot of the current unsynced queue (see
 * UnsyncedSnapshot); does not cancel any pending timer. `final: true` (the
 * pagehide beacon) also commits an undoable held grade first. Pass this to
 * useSyncOnUnload so it can batch only the cards that failed the per-grade path.
 *
 * Guest-mode guard runs on every enqueueGrade call - safe across sign-in
 * state changes mid-session.
 *
 * Persisted queue (#893): the pending queue is written to localStorage on a
 * 500 ms trailing debounce so rapid grading does not thrash storage. The key
 * is cleared after a fully-successful drain. When client/userId are null (guest
 * or superuser write-guard), the key is cleared rather than written - a QA
 * session must never leave fake state behind.
 *
 * Undo hold (#2052): `enqueueGrade(card, { hold: true })` parks the grade in a
 * SEPARATE single slot instead of the push queue, so the practice-page Undo
 * can discard it and the cloud never sees it (a queue entry cannot be deleted
 * without also deleting an earlier unpushed state for the same card, because
 * the queue coalesces by card). The hold is committed (moved to the queue and
 * pushed, and undo expires via `onCommitted`) when: the next grade starts, the
 * component unmounts, the page hides for longer than
 * UNDO_HOLD_HIDDEN_GRACE_MS, pagehide fires (`flushPending(true)`), or
 * UNDO_HOLD_MAX_MS elapses. The held card is persisted to the local pending
 * queue as it is held / when the tab hides, so a force-kill never loses it.
 */
export function usePerGradeSync(
  client: SupabaseClient | null,
  userId: string | null,
  options?: { onCommitted?: (token: number) => void },
): {
  /**
   * Returns a hold token when the grade was held (`hold: true` and signed in),
   * otherwise null.
   */
  enqueueGrade: (card: ReviewableCard, opts?: { hold?: boolean }) => number | null;
  /**
   * Attach the appended grade-log entry to the held grade. Returns true while
   * the hold is still live (undo still possible). Returns false when the hold
   * was already committed: the entry is then pushed immediately.
   */
  attachHeldGradeLog: (token: number, entry: GradeLogEntry | null) => boolean;
  /** Drop the held grade so it is never pushed (Undo). */
  discardHeld: () => void;
  /**
   * Snapshot of what the unload safety-net should send. `final: true`
   * (pagehide) first commits the held grade, handing its grade-log entry to
   * the caller for the beacon; `final: false` (visibilitychange) leaves the
   * hold to the hidden-grace timer.
   */
  flushPending: (final?: boolean) => UnsyncedSnapshot;
} {
  const pendingQueueRef = useRef<ReviewableCard[]>([]);
  const heldRef = useRef<HeldGrade | null>(null);
  const holdTokenRef = useRef(0);
  const holdCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommittedRef = useLatestRef(options?.onCommitted);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep latest client/userId accessible inside the debounce closure without
  // adding them as effect dependencies.
  const clientRef = useLatestRef(client);
  const userIdRef = useLatestRef(userId);
  // Counts consecutive all-failure drains. Reset to 0 on any partial success.
  // When it reaches FAILURE_THRESHOLD, markPushFailed is called so the banner
  // appears (#606).
  const consecutiveFailuresRef = useRef(0);
  // Separate debounce timer for localStorage persistence (#893). Using a
  // longer window (500 ms) than the push debounce (200 ms) so rapid grading
  // does not thrash storage - a short burst of grades produces at most one
  // localStorage write.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount, seed the in-memory queue from any persisted queue left by a
  // previous session that was force-killed before draining (F2 / #1856).
  //
  // Without this, the first fully-successful drain in the new session calls
  // clearPendingQueue() and silently discards grades that were persisted but
  // never pushed.
  //
  // The reconnect/retry paths (useOnlineReconnectSync, useRetryPush) gate on
  // lastPushFailed, but a force-killed tab leaves lastPushFailed=false even
  // when the persisted queue is non-empty, so those paths never fire.
  //
  // By seeding pendingQueueRef here, the ordinary enqueueGrade/drainQueue path
  // picks up and delivers the orphaned grades. The first drain after sign-in
  // sends them to the cloud and then clears the persisted key.
  //
  // Deduplication: the persisted queue was written by the previous session's
  // usePerGradeSync; it should not overlap with the current (fresh) in-memory
  // queue (which starts empty on every mount). Replace the in-memory queue
  // directly rather than merging. If a grade arrives via enqueueGrade before
  // the effect fires (possible in strict-mode double-invocation), deduplicate
  // by locale-aware key so the current grade wins.
  useEffect(() => {
    if (!client || !userId) return;

    const persisted = loadPendingQueue();
    if (persisted.length === 0) return;

    const cardLocaleKey = (card: ReviewableCard) => `${card.id}:${card.locale ?? "en"}`;
    const queue = pendingQueueRef.current;

    if (queue.length === 0) {
      // Common case: empty in-memory queue - seed directly.
      pendingQueueRef.current = [...persisted];
    } else {
      // Rare: a grade arrived before this effect ran. Merge persisted entries
      // that are not already in the in-memory queue (in-memory/current wins).
      const existingKeys = new Set(queue.map(cardLocaleKey));
      const toAdd = persisted.filter((c) => !existingKeys.has(cardLocaleKey(c)));
      pendingQueueRef.current = [...queue, ...toAdd];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId]);

  // Flush the persist debounce on unmount so the last snapshot is written even
  // if the component tears down before the 500 ms window elapses. Flushing
  // (synchronous write) is preferable to dropping because the queue represents
  // grades the user has already submitted - losing the persisted snapshot
  // between the grade and the network push would silently abandon those cards
  // if the tab is then force-killed. The existing push-debounce (timerRef) is
  // left to cancel naturally; it fires async network calls and it is safer to
  // let those complete or abort on their own rather than interrupting mid-flight.
  //
  // The effect itself lives below `commitHeld` (#2052): unmount must commit a
  // held grade BEFORE this flush so the committed card is in the snapshot.

  /**
   * Writes the local pending queue, INCLUDING the held card (held wins on a
   * shared key), or clears the key when both are empty (#893, #2052). Every
   * persist path goes through here so a drain can never wipe the durability
   * copy of a grade that is held but not yet pushed.
   */
  const persistQueue = useCallback(() => {
    const held = heldRef.current?.card ?? null;
    const queue = pendingQueueRef.current;
    if (held === null) {
      if (queue.length === 0) clearPendingQueue();
      else savePendingQueue(queue);
      return;
    }
    const heldKey = cardLocaleKey(held);
    savePendingQueue([...queue.filter((c) => cardLocaleKey(c) !== heldKey), held]);
  }, []);

  const drainQueue = useCallback(async () => {
    const c = clientRef.current;
    const uid = userIdRef.current;
    if (!c || !uid) return;

    // Short-circuit if a structural error was already recorded (#1358). Retrying
    // a schema-mismatch error is pointless until a deploy fixes the mismatch.
    // Exception: allow ONE self-heal probe per session in case a deploy fix landed
    // while the user stayed online (the 'online' event would not fire, so
    // useOnlineReconnectSync cannot reset the flag). If the probe succeeds,
    // pushSingleCard clears structuralSyncError automatically via cloud.ts. If it
    // fails again, the banner persists and subsequent drains continue to
    // short-circuit (#1358 FIX 3).
    if (loadSyncStatus().structuralSyncError !== null) {
      if (hasStructuralProbeBeenAttempted()) {
        // Already probed this session and it failed (or is still in progress).
        // Short-circuit without another attempt.
        return;
      }
      markStructuralProbeAttempted();
      // Fall through - allow the drain to proceed as the single probe attempt.
      // pushSingleCard / pushSession will mark or clear structuralSyncError based
      // on the result, so this path self-heals automatically on success.
    }

    const toSend = [...pendingQueueRef.current];
    if (toSend.length === 0) return;
    // Locale-aware sent/failed sets: key by "id:locale" so cards with the same
    // pokemon id but different locales are tracked independently (#1259).
    const cardLocaleKey = (card: (typeof toSend)[0]) => `${card.id}:${card.locale ?? "en"}`;
    const sentKeys = new Set(toSend.map(cardLocaleKey));

    // No in-flight guard here - concurrent drains produce idempotent upserts,
    // so the only shared-state risk is the pendingQueueRef filter below writing
    // on stale read. That outcome is benign: each drain removes its own sentKeys
    // independently, so no grade is permanently lost. A guard would add
    // complexity without a meaningful correctness benefit.
    const results = await Promise.all(
      toSend.map(async (card) => {
        const result = await pushSingleCard(c, uid, card);
        return { card, result };
      }),
    );

    // Check whether any push produced a new structural error (#1358). If so,
    // markStructuralSyncError was already called inside pushSingleCard - persist
    // the queue so grades survive and return early. Further drains short-circuit
    // on the structuralSyncError guard above (or attempt a single probe next session).
    if (loadSyncStatus().structuralSyncError !== null && !results.some((r) => r.result === "ok")) {
      // At least one card returned a structural error and nothing succeeded.
      persistQueue();
      return;
    }

    // Cards that the regression trigger rejected (SQLSTATE 23514): the cloud row
    // is newer by definition; evict them from the queue rather than retrying
    // forever. Evicted cards are NOT counted as failures for the banner threshold
    // (F23 / #1856). They are silently dropped - the next pull will bring the
    // correct cloud state.
    const rejectedKeys = new Set(
      results.filter((r) => r.result === "rejected").map((r) => cardLocaleKey(r.card)),
    );
    // Cards that failed transiently: keep in the queue for the next drain.
    const failedKeys = new Set(
      results.filter((r) => r.result === "failed").map((r) => cardLocaleKey(r.card)),
    );

    // Keep a card in the queue when:
    //   - its key was NOT in this drain's snapshot (a newer re-grade arrived while
    //     the await was in flight - F51 fix: compare by locale-aware key, NOT by
    //     object identity with toSend.includes(), so a replaced entry survives), OR
    //   - it was sent but failed transiently.
    // Rejected cards (23514) are evicted: they share a sentKey but are in neither
    // failedKeys nor the "not sent" set.
    pendingQueueRef.current = pendingQueueRef.current.filter((card) => {
      const key = cardLocaleKey(card);
      if (!sentKeys.has(key)) return true;   // newer re-grade arrived mid-flight
      if (rejectedKeys.has(key)) return false; // 23514 - evict
      if (failedKeys.has(key)) return true;    // transient failure - keep
      return false;                            // succeeded - remove
    });

    // Update lastPushAt once per debounce flush if at least one card succeeded.
    // Called here (not per-card) so concurrent drains produce at most one write
    // per flush rather than N writes for N cards.
    //
    // Any-success (not all-success) is deliberate (#473): a partial-success
    // debounced push still moved the cloud forward, so the "Last synced"
    // indicator should advance. This differs from the unload path, which
    // flags failure whenever any card failed. See lib/sync/persistence.ts
    // `markPushSucceeded` JSDoc for the full semantics rationale.
    const anySucceeded = results.some((r) => r.result === "ok");
    // True when every result was either ok or rejected (no transient failures).
    // Rejected cards are evicted (the cloud row is newer) so they never re-poison
    // the queue or count against the failure threshold.
    const anyTransientlyFailed = results.some((r) => r.result === "failed");
    if (anySucceeded || (!anyTransientlyFailed && pendingQueueRef.current.length === 0)) {
      // At least one card reached the cloud, OR every card was either ok or
      // rejected (evicted) and the queue is now empty. Either way the cloud
      // made forward progress - clear the failure signal and persist state.
      consecutiveFailuresRef.current = 0;
      if (anySucceeded) markPushSucceeded();
      // If the queue is now empty every card made it to the cloud - the
      // persisted key is cleared so stale data does not accumulate (#893). On
      // partial success the remaining set is persisted so it survives a
      // force-kill. Either way a held (undoable) card is kept in the persisted
      // copy (#2052) - persistQueue owns that rule.
      persistQueue();
    } else {
      // All cards failed this drain transiently. Increment the consecutive-failure
      // counter and surface the banner after FAILURE_THRESHOLD attempts (#606). A
      // single network blip should not show the banner; three consecutive all-failure
      // drains strongly suggests the push channel is broken.
      //
      // Use === (not >=) so markPushFailed fires exactly once per failure
      // episode - only on the transition from threshold-1 to threshold. When
      // failures resume after a successful drain resets the counter, the next
      // === hit naturally re-fires.
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current === FAILURE_THRESHOLD) {
        markPushFailed(pendingQueueRef.current.length);
        // Register a Background Sync tag so the SW can replay the persisted
        // queue when connectivity is restored, even if the user closes every
        // tab before the online-reconnect hook fires (#1072 concern). The
        // persisted queue is already up to date (the savePendingQueue call
        // below follows). Best-effort: fire and forget.
        void registerBackgroundSync();
      }
      // Persist the still-queued cards so they survive a force-kill (#893).
      // This write runs unconditionally on all-failure - the pending-queue
      // persistence debounce in enqueueGrade catches the common hot path;
      // this is the safety-net for the drain's own updated state.
      persistQueue();
    }
  }, [persistQueue]);

  /** Debounced write of the local pending queue (+ held card), #893 / #2052. */
  const schedulePersist = useCallback(() => {
    // A longer window than the push debounce so rapid grading produces at most
    // one storage write per burst. The drain itself also writes (or clears)
    // the key after the network result is known; this earlier write ensures
    // the key is current even if the tab is force-killed before the push
    // debounce fires.
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistQueue();
    }, PERSIST_DEBOUNCE_MS);
  }, [persistQueue]);

  const scheduleDrain = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void drainQueue();
    }, 200);
  }, [drainQueue]);

  const clearHoldTimers = useCallback(() => {
    if (holdCapTimerRef.current !== null) {
      clearTimeout(holdCapTimerRef.current);
      holdCapTimerRef.current = null;
    }
    if (hiddenGraceTimerRef.current !== null) {
      clearTimeout(hiddenGraceTimerRef.current);
      hiddenGraceTimerRef.current = null;
    }
  }, []);

  /**
   * Commits the held grade (#2052): the card joins the push queue (coalescing
   * by card key like any other grade) and its grade-log entry is pushed, then
   * undo expires via `onCommitted`. No-op when nothing is held.
   *
   * `mode: "beacon"` (pagehide) does not fire the grade-log fetch, since the
   * page is being torn down; the entry is returned so the caller can carry it
   * in the beacon payload instead.
   *
   * If sync went away mid-hold (sign-out, superuser flag) the slot is cleared
   * but nothing is pushed or queued: the write-guard must hold.
   */
  const commitHeld = useCallback(
    (mode: "push" | "beacon" = "push"): GradeLogEntry | null => {
      const held = heldRef.current;
      if (held === null) return null;
      heldRef.current = null;
      clearHoldTimers();
      if (held.gradeLog !== null) releaseCloudPushHold(held.gradeLog.occurredAt);

      const c = clientRef.current;
      const uid = userIdRef.current;
      let forBeacon: GradeLogEntry | null = null;
      if (c && uid) {
        if (held.card !== null) {
          const key = cardLocaleKey(held.card);
          const queue = pendingQueueRef.current;
          const idx = queue.findIndex((q) => cardLocaleKey(q) === key);
          if (idx >= 0) queue[idx] = held.card;
          else queue.push(held.card);
          scheduleDrain();
          schedulePersist();
        }
        if (held.gradeLog !== null) {
          if (mode === "beacon") forBeacon = held.gradeLog;
          else void pushGradeLogEntry(c, uid, held.gradeLog);
        }
      }
      onCommittedRef.current?.(held.token);
      return forBeacon;
    },
    [clearHoldTimers, scheduleDrain, schedulePersist],
  );

  const discardHeld = useCallback(() => {
    const held = heldRef.current;
    if (held === null) return;
    heldRef.current = null;
    clearHoldTimers();
    if (held.gradeLog !== null) releaseCloudPushHold(held.gradeLog.occurredAt);
    // Re-save the persisted queue WITHOUT the held card so a reload cannot
    // push a grade the user undid.
    persistQueue();
  }, [clearHoldTimers, persistQueue]);

  const attachHeldGradeLog = useCallback((token: number, entry: GradeLogEntry | null): boolean => {
    const held = heldRef.current;
    if (held !== null && held.token === token) {
      if (entry !== null) held.gradeLog = entry;
      return true;
    }
    // The hold was committed while the entry was still being appended (rapid
    // next grade): nothing will push it at commit time, so push it now.
    if (entry !== null) {
      releaseCloudPushHold(entry.occurredAt);
      const c = clientRef.current;
      const uid = userIdRef.current;
      if (c && uid) void pushGradeLogEntry(c, uid, entry);
    }
    return false;
  }, []);

  // Hidden-tab handling for a held grade (#2052). On hide, persist the held
  // card locally straight away (a mobile tab can be killed with no further
  // event) and start the grace timer; if the tab is still hidden when it
  // fires, commit. Becoming visible again cancels the timer.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        if (heldRef.current === null) return;
        persistQueue();
        if (hiddenGraceTimerRef.current !== null) clearTimeout(hiddenGraceTimerRef.current);
        hiddenGraceTimerRef.current = setTimeout(() => {
          hiddenGraceTimerRef.current = null;
          if (document.visibilityState === "hidden") commitHeld();
        }, UNDO_HOLD_HIDDEN_GRACE_MS);
      } else if (hiddenGraceTimerRef.current !== null) {
        clearTimeout(hiddenGraceTimerRef.current);
        hiddenGraceTimerRef.current = null;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [commitHeld, persistQueue]);

  // Unmount: commit a held grade FIRST (SPA navigation ends the undo window),
  // then flush the persist debounce so the last snapshot is written even if the
  // component tears down before the 500 ms window elapses (see the note above
  // `persistQueue`).
  useEffect(() => {
    return () => {
      commitHeld();
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        persistQueue();
      }
    };
  }, [commitHeld, persistQueue]);

  const enqueueGrade = useCallback(
    (card: ReviewableCard, opts?: { hold?: boolean }): number | null => {
      const hold = opts?.hold === true;
      // A new grade always closes the previous grade's undo window (#2052).
      if (hold) commitHeld();

      // If the user signs out within the 200 ms debounce window the guard exits
      // early and this grade is not synced. The unload safety-net also bails
      // because client/userId are null by then. Accepted best-effort loss.
      //
      // When client/userId are null the session is either guest-mode or a
      // superuser write-guarded session. In either case, clear the persisted
      // queue rather than writing to it - a QA session must never leave fake
      // card state behind (#893 superuser guard).
      if (!clientRef.current || !userIdRef.current) {
        clearPendingQueue();
        return null;
      }

      if (hold) {
        // Park the grade in the separate hold slot (#2052). An in-step card is
        // not safe to write to the cloud (see below), so only its grade-log leg
        // is held; the card leg is skipped exactly as on the immediate path.
        const token = ++holdTokenRef.current;
        heldRef.current = { token, card: isSyncSafe(card) ? card : null, gradeLog: null };
        holdCapTimerRef.current = setTimeout(() => {
          holdCapTimerRef.current = null;
          commitHeld();
        }, UNDO_HOLD_MAX_MS);
        schedulePersist();
        return token;
      }

      // Skip in-step cards entirely - they are not safe to write to the cloud
      // until they graduate (lastReview set). Enqueuing them would cause
      // pushSingleCard to return false and keep them in the retry queue forever.
      if (!isSyncSafe(card)) return null;

      // Replace existing entry for this card or append.
      // Use a locale-aware key so cards with the same id but different locales
      // are treated as distinct entries (#1259).
      const key = cardLocaleKey(card);
      const queue = pendingQueueRef.current;
      const idx = queue.findIndex((c) => cardLocaleKey(c) === key);
      if (idx >= 0) {
        queue[idx] = card;
      } else {
        queue.push(card);
      }

      scheduleDrain();
      schedulePersist();
      return null;
    },
    [commitHeld, scheduleDrain, schedulePersist],
  );

  const flushPending = useCallback((final = false): UnsyncedSnapshot => {
    // pagehide (final) closes the undo window; visibilitychange leaves the
    // hold to the hidden-grace timer but reports the held card so the caller
    // keeps it in the local pending queue rather than wiping it.
    const held = final ? null : heldRef.current?.card ?? null;
    const gradeLog = final ? commitHeld("beacon") : null;
    return {
      cards: [...pendingQueueRef.current],
      gradeLog: gradeLog === null ? [] : [gradeLog],
      heldCards: held === null ? [] : [held],
    };
  }, [commitHeld]);

  return { enqueueGrade, attachHeldGradeLog, discardHeld, flushPending };
}
