"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeCloudIntoLocalSilent, pullSession, pushSession, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { mergeStreak, pullStreak, pushStreak } from "@/lib/sync/streak";
import { pullSettings, pushSettings } from "@/lib/sync/settings";
import { mergeGradeLog, pullGradeLog, pushGradeLog } from "@/lib/sync/gradeLog";
import { loadGradeLog, saveGradeLog } from "@/lib/gradelog/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
import { loadStreakData, saveStreakData, STREAK_UPDATED_EVENT } from "@/lib/streak/persistence";
import { hasStoredSettings, loadSettings, saveSettings } from "@/lib/settings/persistence";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { SEED_EVOLUTION_CARDS, SEED_POKEMON } from "@/lib/pokemon/seed";

export type ManualSyncState = "idle" | "syncing" | "success" | "error";

export function useManualSync(
  client: SupabaseClient | null,
  userId: string | null,
): {
  syncState: ManualSyncState;
  errorMessage: string | null;
  syncNow: () => void;
} {
  const [syncState, setSyncState] = useState<ManualSyncState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // cancelledRef lets the async run() know it should skip state updates once
  // the component has unmounted or a new invocation has superseded this one.
  const cancelledRef = useRef(false);

  // Track the auto-reset timeout so it can be cleared on unmount.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronous in-progress flag — closes the race window where two calls in
  // the same tick both pass the syncState === "syncing" closure check before
  // the state batch re-renders.
  const isSyncingRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const syncNow = useCallback(() => {
    if (client === null || userId === null || isSyncingRef.current) {
      return;
    }
    isSyncingRef.current = true;

    // Supersede any pending auto-reset from a previous run.
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    // Mark any in-flight async work from a previous syncNow call as stale.
    cancelledRef.current = false;

    setSyncState("syncing");
    setErrorMessage(null);

    async function run() {
      if (!client || !userId) return;

      // Step a: load local session.
      const localSession = loadSession();

      // Step b: pull cloud rows FIRST. Pulling before pushing means a local
      // session that has lost progress (Safari ITP eviction, fresh device,
      // manual storage clear) cannot upload its emptied state over real
      // cloud data. See #293 for the incident that motivated this order.
      const cloudRows = await pullSession(client, userId);
      if (cancelledRef.current) return;
      if (cloudRows === null) {
        const prev = loadSyncStatus();
        saveSyncStatus({
          ...prev,
          lastPushFailed: true,
          lastPushAttemptAt: new Date().toISOString(),
          failedCardCount: null,
        });
        isSyncingRef.current = false;
        setSyncState("error");
        setErrorMessage("Could not fetch cloud data — check your connection.");
        return;
      }

      // Step c: merge cloud into local and persist. The merge is anchored on
      // the pre-existing lastPullAt so any card with local progress since the
      // last successful pull is protected — the user-initiated Sync button is
      // a reconcile, not a force-overwrite (closes #367). Brand-new devices
      // (no localSession) still take cloud naturally: every card is pristine,
      // so the silent merge applies cloud the same as the old unconditional
      // overlay did.
      const preMergeSyncStatus = loadSyncStatus();
      let mergedCards;
      let mergedLimits;
      if (localSession !== null) {
        mergedCards = mergeCloudIntoLocalSilent(
          localSession.cards,
          cloudRows,
          preMergeSyncStatus.lastPullAt,
        );
        mergedLimits = localSession.limits;
      } else {
        // Brand-new device: build a fresh base session so cloud state has
        // a card list to merge into; otherwise cloud rows would be discarded.
        //
        // Pull cloud settings FIRST when local has none — otherwise the base
        // would use DEFAULT_SETTINGS (reverse/cry disabled) and cloud rows for
        // those types would be silently dropped by the merge (#391).
        if (!hasStoredSettings()) {
          try {
            const cloudSettings = await pullSettings(client, userId);
            if (cancelledRef.current) return;
            if (cloudSettings !== null) saveSettings(cloudSettings);
          } catch {
            console.warn("[sync] brand-new-device settings pull failed; continuing with defaults");
          }
        }
        const settings = loadSettings();
        const base = buildSession(
          SEED_POKEMON,
          SEED_EVOLUTION_CARDS,
          undefined,
          seedOptsFromSettings(settings),
        );
        mergedCards = mergeCloudIntoLocalSilent(
          base,
          cloudRows,
          preMergeSyncStatus.lastPullAt,
        );
        mergedLimits = DEFAULT_LIMITS;
      }

      const saveResult = saveSession({ cards: mergedCards, limits: mergedLimits });

      if (cancelledRef.current) return;

      if (!saveResult.ok) {
        const prev = loadSyncStatus();
        saveSyncStatus({
          ...prev,
          lastPushFailed: true,
          lastPushAttemptAt: new Date().toISOString(),
          failedCardCount: null,
        });
        isSyncingRef.current = false;
        setSyncState("error");
        setErrorMessage(
          "Sync failed — storage is full. Clear browser data and try again.",
        );
        return;
      }

      // Step d: push merged session back so any local-only progress reaches
      // cloud. Skip when starting from a brand-new device (no localSession):
      // the merged state is entirely cloud-sourced, so pushing it would be
      // a no-op round trip.
      if (localSession !== null) {
        const pushOk = await pushSession(client, userId, mergedCards);
        if (cancelledRef.current) return;
        if (!pushOk) {
          const prev = loadSyncStatus();
          saveSyncStatus({
            ...prev,
            lastPushFailed: true,
            lastPushAttemptAt: new Date().toISOString(),
            failedCardCount: null,
          });
          isSyncingRef.current = false;
          setSyncState("error");
          setErrorMessage("Sync failed — check your connection and try again.");
          return;
        }
      }

      // Step e: streak sync. Union-merge — never destructive; failures are
      // logged but do not flip the overall sync into the error state, since
      // streak is auxiliary to card review state.
      const cloudStreak = await pullStreak(client, userId);
      if (cancelledRef.current) return;
      if (cloudStreak !== null) {
        const localStreak = loadStreakData();
        const merged = mergeStreak(localStreak, cloudStreak);
        if (
          merged.length !== localStreak.length ||
          merged.some((d, i) => d !== localStreak[i])
        ) {
          saveStreakData(merged);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
          }
        }
        if (merged.length > 0) {
          const streakOk = await pushStreak(client, userId, merged);
          if (!streakOk) {
            console.warn("[sync] streak push failed; continuing");
          }
        }
      } else {
        console.warn("[sync] streak pull failed; continuing");
      }

      // Step f: settings sync. Last-write-wins on the whole object. If local
      // has never been written explicitly (post-logout, fresh device), let
      // cloud overlay local; otherwise the local copy is authoritative and we
      // push it up. Cross-device "I changed it on A, see it on B" is a known
      // limitation tracked separately — see #294.
      const localHasSettings = hasStoredSettings();
      const cloudSettings = await pullSettings(client, userId);
      if (cancelledRef.current) return;
      if (cloudSettings !== null && !localHasSettings) {
        saveSettings(cloudSettings);
      }
      const settingsOk = await pushSettings(client, userId, loadSettings());
      if (!settingsOk) {
        console.warn("[sync] settings push failed; continuing");
      }
      if (cancelledRef.current) return;

      // Step g: grade-log sync. Union-merge by `occurredAt`; auxiliary
      // analytics data — failures warn and continue.
      const cloudGradeLog = await pullGradeLog(client, userId);
      if (cancelledRef.current) return;
      if (cloudGradeLog !== null) {
        const localGradeLog = loadGradeLog();
        const merged = mergeGradeLog(localGradeLog, cloudGradeLog);
        if (merged.length !== localGradeLog.length) {
          saveGradeLog(merged);
        }
        if (merged.length > 0) {
          const gradeLogOk = await pushGradeLog(client, userId, merged);
          if (!gradeLogOk) {
            console.warn("[sync] grade log push failed; continuing");
          }
        }
      } else {
        console.warn("[sync] grade log pull failed; continuing");
      }
      if (cancelledRef.current) return;

      // Step h: record successful sync metadata. Anchoring lastPullAt to the
      // server-derived max updated_at across pulled rows is what protects the
      // conflict-resolution rule in subsequent background pulls — without it,
      // a user who only ever syncs via this button keeps lastPullAt null and
      // hits the destructive cloud-wins path on the next pullAndMerge. See #359.
      const now = new Date().toISOString();
      const prev = loadSyncStatus();
      saveSyncStatus({
        ...prev,
        lastPushAt: now,
        lastPushFailed: false,
        lastPushAttemptAt: now,
        failedCardCount: 0,
        lastPullAt: maxCloudUpdatedAt(cloudRows),
      });

      // Step f: surface success.
      setSyncState("success");

      // Step g: auto-reset to idle after 3 seconds. isSyncingRef is reset
      // here (not at step f) so programmatic syncNow calls during the success
      // window are still blocked until the button re-enables itself.
      resetTimerRef.current = setTimeout(() => {
        isSyncingRef.current = false;
        if (!cancelledRef.current) {
          setSyncState("idle");
        }
        resetTimerRef.current = null;
      }, 3000);
    }

    void run().catch((err) => {
      console.error(err);
      isSyncingRef.current = false;
      if (!cancelledRef.current) {
        setSyncState("error");
        setErrorMessage("Sync failed — check your connection and try again.");
      }
    });
  }, [client, userId]);

  return { syncState, errorMessage, syncNow };
}
