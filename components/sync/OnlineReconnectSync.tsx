"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useOnlineReconnectSync } from "@/lib/sync/useOnlineReconnectSync";

/**
 * Renders nothing. Mounted in the root layout so that when the device comes
 * back online after an offline period, any cards that failed to sync during
 * that time are automatically pushed to the cloud (after a pull to merge any
 * remote changes first).
 *
 * Passes `null` for client and userId when any superuser flag is on, honouring
 * the sync write-guard - QA sessions never leak fake state into Supabase.
 */
export function OnlineReconnectSync() {
  const { user, supabase } = useAuth();
  const { anyFlagOn } = useSuperuser();

  // Mirror the superuser write-guard used by AutoSyncOnChange and ReviewSession.
  const client = anyFlagOn ? null : supabase;
  const userId = anyFlagOn ? null : user?.id ?? null;

  useOnlineReconnectSync(client, userId);
  return null;
}
