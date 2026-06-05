"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { pushSettings } from "@/lib/sync/settings";
import { pushStreak } from "@/lib/sync/streak";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import { markPushSucceeded } from "@/lib/sync/persistence";
import {
  SETTINGS_SAVED_EVENT,
  type UserSettings,
} from "@/lib/settings/persistence";
import {
  diffSettings,
  loadLastPushedSettings,
  saveLastPushedSettings,
} from "@/lib/settings/lastPushedSnapshot";
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
 * (settings, streak, grade log) to Supabase without waiting for user action.
 * See #319.
 *
 * Cards already have an equivalent path via `usePerGradeSync`; this covers
 * the three remaining client-stored data types. All three pushes are
 * best-effort - failures `console.warn` and continue.
 *
 * Cross-device catch-up is handled by: periodic background pull via
 * `useVisibilityPull` (`components/sync/SyncOnVisible.tsx`), sign-in pull
 * (`components/sync/SignInPull.tsx`), and the narrow Retry on the Stats page
 * for the cards-failed case (`lib/sync/useRetryPush.ts`).
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
      // Diff against the last successful push so we send only changed
      // top-level keys (#583). Two devices changing disjoint settings now
      // both stick - the merge_user_settings `||` overlay only touches
      // keys present in the patch. First push from this device sends
      // everything (snapshot null) and is identical to the pre-#583
      // behaviour.
      const prev = loadLastPushedSettings();
      const patch = diffSettings(prev, detail);
      if (Object.keys(patch).length === 0) return;
      void pushSettings(client!, userId!, patch).then((ok) => {
        if (ok) {
          // Stamp the snapshot to the full detail (not the patch) so the
          // next diff is computed against what cloud now holds, not the
          // shrunk patch. If the push failed we leave the snapshot
          // unchanged - the next save will resend the same keys plus any
          // new ones.
          saveLastPushedSettings(detail);
          markPushSucceeded();
        } else {
          console.warn("[auto-sync] settings push failed; will retry on next save");
        }
      });
    }

    function handleStreak() {
      const dates = loadStreakData();
      if (dates.length === 0) return;
      void pushStreak(client!, userId!, dates).then((ok) => {
        if (ok) {
          markPushSucceeded();
        } else {
          console.warn("[auto-sync] streak push failed; will retry on next review");
        }
      });
    }

    function handleGradeLog(e: Event) {
      const detail = (e as CustomEvent<GradeLogEntry>).detail;
      if (!detail) return;
      void pushGradeLog(client!, userId!, [detail]).then((ok) => {
        if (ok) {
          markPushSucceeded();
        } else {
          console.warn("[auto-sync] grade log push failed; will retry on next grade");
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
