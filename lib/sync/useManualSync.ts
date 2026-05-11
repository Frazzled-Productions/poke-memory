"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeCloudIntoLocal, pullSession, pushSession } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";
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
    if (client === null || userId === null || syncState === "syncing") {
      return;
    }

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

      // Step b: push local session to cloud if present.
      if (localSession !== null) {
        const pushOk = await pushSession(client, userId, localSession.cards);
        if (cancelledRef.current) return;
        if (!pushOk) {
          const prev = loadSyncStatus();
          saveSyncStatus({
            ...prev,
            lastPushFailed: true,
            lastPushAttemptAt: new Date().toISOString(),
          });
          setSyncState("error");
          setErrorMessage("Sync failed — check your connection and try again.");
          return;
        }
      }

      // Step c: pull cloud rows.
      const cloudRows = await pullSession(client, userId);
      if (cancelledRef.current) return;
      if (cloudRows === null) {
        setSyncState("error");
        setErrorMessage("Could not fetch cloud data — check your connection.");
        return;
      }

      // Step d: merge cloud into local and persist.
      if (localSession !== null) {
        const merged = mergeCloudIntoLocal(localSession.cards, cloudRows);
        saveSession({ cards: merged, limits: localSession.limits });
      } else {
        // Brand-new device: build a fresh base session so cloud state has
        // a card list to merge into; otherwise cloud rows would be discarded.
        const base = buildSession(SEED_POKEMON, SEED_EVOLUTION_CARDS);
        const merged = mergeCloudIntoLocal(base, cloudRows);
        saveSession({ cards: merged, limits: DEFAULT_LIMITS });
      }

      if (cancelledRef.current) return;

      // Step e: record successful sync metadata.
      const now = new Date().toISOString();
      const prev = loadSyncStatus();
      saveSyncStatus({
        ...prev,
        lastPushAt: now,
        lastPushFailed: false,
        lastPushAttemptAt: now,
      });

      // Step f: surface success.
      setSyncState("success");

      // Step g: auto-reset to idle after 3 seconds.
      resetTimerRef.current = setTimeout(() => {
        if (!cancelledRef.current) {
          setSyncState("idle");
        }
        resetTimerRef.current = null;
      }, 3000);
    }

    void run().catch(() => {
      if (!cancelledRef.current) {
        setSyncState("error");
        setErrorMessage("Sync failed — check your connection and try again.");
      }
    });
  }, [client, userId, syncState]);

  return { syncState, errorMessage, syncNow };
}
