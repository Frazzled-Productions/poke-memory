"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  computeStreak,
  effectiveStreakDates,
  loadStreakData,
  STREAK_UPDATED_EVENT,
} from "@/lib/streak";
import { runStreakProtection } from "@/lib/streak/runProtection";
import { findPendingMilestone } from "@/lib/streak/milestones";
import { useStreakNavState } from "@/lib/streak/useStreakNavState";
import { todayString } from "@/lib/review/session";
import {
  loadSettings,
  saveSettings,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { MilestoneCelebration } from "@/components/streak/MilestoneCelebration";
import {
  ProtectionToast,
  type ProtectionToastKind,
} from "@/components/review/ProtectionToast";

export function StreakBadge() {
  const t = useTranslations("review");
  // Token balance + next-milestone signpost, surfaced here on the Practice
  // screen (and on Stats) rather than in the nav bar (#1443 QA). Reuses the
  // shared read-only hook and the `nav.streakChip.*` copy.
  const tChip = useTranslations("nav.streakChip");
  const { tokenBalance, daysToNextMilestone } = useStreakNavState();
  const [streak, setStreak] = useState<number | null>(null);
  const [pendingMilestone, setPendingMilestone] = useState<number | null>(null);
  const [pendingToken, setPendingToken] = useState<ProtectionToastKind | null>(
    null,
  );
  const { flags, setFlag } = useSuperuser();

  // Guard against re-showing the token toast on subsequent events within the
  // same page visit. `runStreakProtection` is idempotent, but the
  // STREAK_UPDATED_EVENT and SETTINGS_SAVED_EVENT can both fire multiple times
  // during a session (e.g. on a settings save), and the earn guard in
  // `applyProtectionStep` only prevents a *second earn on the same calendar
  // day* — it does not prevent repeated `earned=true` returns when the result
  // is read back from a stale-snapshot call path. A per-visit ref is the
  // simplest, safest guard.
  const hasShownTokenToastRef = useRef(false);

  // Recompute streak and milestone-to-fire whenever the underlying data
  // changes. Reads `loadSettings()` fresh inside the callback so a dismiss
  // (which writes `seenStreakMilestones`) is reflected on the next event.
  useEffect(() => {
    function refresh() {
      // Load settings before computing `today` so the protection pass and
      // streak computation both honour the user's timezone — the streakDates
      // set is populated in the user's local tz (see ReviewSession), so a
      // UTC `today` would cause off-by-one boundary errors at high offsets.
      const settings = loadSettings();
      const today = todayString(new Date(), settings.timezone ?? "UTC");
      // Run the streak-protection step before computing the streak so a token
      // spend (if any) bridges yesterday's gap. The step is idempotent across
      // same-day calls.
      const protectionResult = runStreakProtection(today);
      const s = computeStreak(
        effectiveStreakDates(
          loadStreakData(),
          settings.streakProtection?.spendDates ?? [],
        ),
        today,
      );
      setStreak(s);
      const seen = settings.seenStreakMilestones;
      if (flags.forceNextStreakMilestone) {
        // QA cheat: fire the smallest un-seen milestone regardless of actual
        // streak. Picks from STREAK_MILESTONES via findPendingMilestone with
        // a very large effective streak so all milestones are "reached".
        setPendingMilestone(findPendingMilestone(Number.MAX_SAFE_INTEGER, seen));
      } else {
        setPendingMilestone(findPendingMilestone(s, seen));
      }

      // Fire a token toast when the protection step earned or spent a token,
      // but only once per page visit (the ref guard prevents re-fires from
      // subsequent event dispatches within the same visit).
      let realToastFired = false;
      if (!hasShownTokenToastRef.current && protectionResult != null) {
        const { earned, spent } = protectionResult;
        if (earned && spent) {
          setPendingToken("earned-and-spent");
          hasShownTokenToastRef.current = true;
          realToastFired = true;
        } else if (earned) {
          setPendingToken("earned");
          hasShownTokenToastRef.current = true;
          realToastFired = true;
        } else if (spent) {
          setPendingToken("spent");
          hasShownTokenToastRef.current = true;
          realToastFired = true;
        }
      }

      // QA cheat: force the "token earned" helper toast regardless of actual
      // token state, so the earn message is testable without a 30-day streak.
      // Only fires when no genuine earn/spend toast was produced this pass (so
      // it never masks a real "spent"/"earned-and-spent" event), and only once
      // per visit via the same ref guard as the real path, making the "exactly
      // once per toggle" invariant explicit. Self-clears on dismiss.
      if (
        flags.forceTokenToast &&
        !realToastFired &&
        !hasShownTokenToastRef.current
      ) {
        setPendingToken("earned");
        hasShownTokenToastRef.current = true;
      }
    }
    refresh();
    window.addEventListener(STREAK_UPDATED_EVENT, refresh);
    window.addEventListener(SETTINGS_SAVED_EVENT, refresh);
    return () => {
      window.removeEventListener(STREAK_UPDATED_EVENT, refresh);
      window.removeEventListener(SETTINGS_SAVED_EVENT, refresh);
    };
  }, [flags.forceNextStreakMilestone, flags.forceTokenToast]);

  const dismissMilestone = useCallback(() => {
    if (pendingMilestone === null) return;
    setPendingMilestone(null);
    if (flags.forceNextStreakMilestone) {
      // QA fire: do not persist the milestone as seen — the user hasn't
      // genuinely reached it. Just self-clear the flag so QA gets exactly
      // one forced fire per toggle.
      void setFlag("forceNextStreakMilestone", false);
      return;
    }
    const current = loadSettings();
    if (!current.seenStreakMilestones.includes(pendingMilestone)) {
      saveSettings({
        ...current,
        seenStreakMilestones: [
          ...current.seenStreakMilestones,
          pendingMilestone,
        ],
      });
    }
  }, [pendingMilestone, flags.forceNextStreakMilestone, setFlag]);

  const dismissToken = useCallback(() => {
    setPendingToken(null);
    if (flags.forceTokenToast) {
      // QA fire: self-clear so the forced toast shows exactly once per toggle.
      void setFlag("forceTokenToast", false);
    }
  }, [flags.forceTokenToast, setFlag]);

  if (streak === null) return null;

  return (
    <>
      <div className="mb-1 flex items-center justify-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {streak === 0
            ? t("startStreak")
            : t("streakDays", { count: streak })}
        </span>
        {tokenBalance !== null && tokenBalance >= 1 && (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {tChip("tokenLabel", { count: tokenBalance })}
          </span>
        )}
      </div>
      {daysToNextMilestone !== null && (
        <p className="mb-2 text-center text-xs text-zinc-500 dark:text-zinc-400 sm:mb-4">
          {tChip("milestoneLabel", { count: daysToNextMilestone })}
        </p>
      )}
      {pendingMilestone !== null && (
        <MilestoneCelebration
          key={pendingMilestone}
          milestone={pendingMilestone}
          onDismiss={dismissMilestone}
        />
      )}
      {pendingToken !== null && (
        <ProtectionToast
          key={pendingToken}
          kind={pendingToken}
          streakCount={streak}
          onDismiss={dismissToken}
        />
      )}
    </>
  );
}
