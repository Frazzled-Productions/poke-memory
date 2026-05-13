"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pushSettings } from "@/lib/sync/settings";
import { pushStreak } from "@/lib/sync/streak";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import {
  SETTINGS_SAVED_EVENT,
  type UserSettings,
} from "@/lib/settings/persistence";
import {
  STREAK_UPDATED_EVENT,
  loadStreakData,
} from "@/lib/streak/persistence";
import {
  GRADE_LOG_APPENDED_EVENT,
  type GradeLogEntry,
} from "@/lib/gradelog/persistence";

/**
 * Renders nothing. Mounted in the root layout to push local-only changes
 * (settings, streak, grade log) to Supabase without waiting for the user
 * to hit the manual Sync button. See #319.
 *
 * Cards already have an equivalent path via `usePerGradeSync`; this
 * covers the three remaining client-stored data types. All three pushes
 * are best-effort — failures `console.warn` and continue. Manual sync
 * (`useManualSync`) remains the cross-device catch-up / force-resync
 * path.
 */
export function AutoSyncOnChange() {
  const { user, supabase } = useAuth();
  const { anyFlagOn } = useSuperuser();
  // Treat the user as signed-out when any superuser flag is on, so settings/
  // streak/grade-log writes all skip the cloud during a QA session.
  const userId = anyFlagOn ? null : user?.id ?? null;
  const client = anyFlagOn ? null : supabase;

  useEffect(() => {
    if (!client || !userId) return;

    function handleSettings(e: Event) {
      const detail = (e as CustomEvent<UserSettings>).detail;
      if (!detail) return;
      void pushSettings(client!, userId!, detail).then((ok) => {
        if (!ok) {
          console.warn("[auto-sync] settings push failed; will retry on next save or manual Sync");
        }
      });
    }

    function handleStreak() {
      const dates = loadStreakData();
      if (dates.length === 0) return;
      void pushStreak(client!, userId!, dates).then((ok) => {
        if (!ok) {
          console.warn("[auto-sync] streak push failed; will retry on next review or manual Sync");
        }
      });
    }

    function handleGradeLog(e: Event) {
      const detail = (e as CustomEvent<GradeLogEntry>).detail;
      if (!detail) return;
      void pushGradeLog(client!, userId!, [detail]).then((ok) => {
        if (!ok) {
          console.warn("[auto-sync] grade log push failed; will retry on next grade or manual Sync");
        }
      });
    }

    window.addEventListener(SETTINGS_SAVED_EVENT, handleSettings);
    window.addEventListener(STREAK_UPDATED_EVENT, handleStreak);
    window.addEventListener(GRADE_LOG_APPENDED_EVENT, handleGradeLog);

    return () => {
      window.removeEventListener(SETTINGS_SAVED_EVENT, handleSettings);
      window.removeEventListener(STREAK_UPDATED_EVENT, handleStreak);
      window.removeEventListener(GRADE_LOG_APPENDED_EVENT, handleGradeLog);
    };
  }, [supabase, userId]);

  return null;
}
