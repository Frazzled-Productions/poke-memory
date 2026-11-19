"use client";

/**
 * ForcePullSection - "Restore from cloud" recovery action.
 *
 * Moved from app/stats/page.tsx to Settings "Data & backup" section (#1732 / #1729).
 * Primary home is now Settings; Stats shows only a link to /settings.
 *
 * Visible only when the user is signed in (db !== null && userId is set)
 * and superuser mode is off. The calling page enforces this gate.
 */

import { useState } from "react";
import type { DataClient } from "@/lib/db/client";
import { useTranslations } from "next-intl";
import { useSeed } from "@/lib/pokemon/SeedContext";
import { pullSession, applyCloudAuthoritative, maxCloudUpdatedAt } from "@/lib/sync/cloud";
import { pullSettingsWithTimestamp, pullRegionalPrefs } from "@/lib/sync/settings";
import { pullStreak } from "@/lib/sync/streak";
import { pullGradeLog } from "@/lib/sync/gradeLog";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { saveStreakData } from "@/lib/streak/persistence";
import { saveGradeLog } from "@/lib/gradelog/persistence";
import { loadSession, saveSession, bumpSessionStorageKey } from "@/lib/review/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import { cn } from "@/lib/utils/cn";
import { colStack, mutedText } from "@/lib/utils/class-names";

type ForcePullStatus = "idle" | "pulling" | "success" | "error";

interface ForcePullSectionProps {
  db: DataClient;
  userId: string;
}

export function ForcePullSection({ db, userId }: ForcePullSectionProps) {
  const t = useTranslations("stats");
  const { seed } = useSeed();
  const [status, setStatus] = useState<ForcePullStatus>("idle");

  async function handleForcePull() {
    const confirmed = window.confirm(t("forcePull.confirmMessage"));
    if (!confirmed) return;

    setStatus("pulling");
    try {
      const [
        cloudRows,
        pulledSettings,
        cloudPrefs,
        cloudStreak,
        cloudGradeLog,
      ] = await Promise.all([
        pullSession(db, userId),
        pullSettingsWithTimestamp(db, userId).catch(() => null),
        pullRegionalPrefs(db, userId).catch(() => null),
        pullStreak(db, userId).catch(() => null),
        pullGradeLog(db, userId).catch(() => null),
      ]);

      if (cloudRows === null) {
        setStatus("error");
        return;
      }

      if (pulledSettings !== null) {
        saveSettings(pulledSettings.settings);
      }

      if (cloudPrefs !== null) {
        const local = loadSettings();
        const next = {
          ...local,
          ...(cloudPrefs.timezone !== null ? { timezone: cloudPrefs.timezone } : {}),
          ...(cloudPrefs.dateFormat !== null ? { dateFormat: cloudPrefs.dateFormat } : {}),
        };
        if (next.timezone !== local.timezone || next.dateFormat !== local.dateFormat) {
          saveSettings(next);
        }
      }

      const settings = loadSettings();
      const opts = seedOptsFromSettings(settings);
      const cards = applyCloudAuthoritative(
        seed?.seedPokemon ?? [],
        seed?.seedEvolutionCards ?? [],
        cloudRows,
        opts,
      );

      if (cloudStreak !== null) {
        saveStreakData([...cloudStreak].sort());
      }
      if (cloudGradeLog !== null) {
        await saveGradeLog(cloudGradeLog);
      }

      const saved = await loadSession();
      const limits = saved?.limits ?? DEFAULT_LIMITS;
      const result = await saveSession({ cards, limits });

      if (!result.ok) {
        setStatus("error");
        return;
      }

      const syncStatus = loadSyncStatus();
      saveSyncStatus({
        ...syncStatus,
        lastPullAt: maxCloudUpdatedAt(cloudRows),
        ...(pulledSettings?.updatedAt !== undefined &&
        pulledSettings.updatedAt !== null
          ? { lastSettingsPullAt: pulledSettings.updatedAt }
          : {}),
      });

      bumpSessionStorageKey();

      setStatus("success");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className={colStack}>
      <p className={cn("mb-1", mutedText)}>
        {t("forcePull.description")}
      </p>
      <button
        type="button"
        onClick={() => void handleForcePull()}
        disabled={status === "pulling"}
        aria-busy={status === "pulling"}
        className="mt-1 min-h-[44px] self-start rounded-lg border border-zinc-300 bg-background px-5 py-2 text-sm font-semibold text-foreground transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700"
      >
        {status === "pulling" ? t("forcePull.pulling") : t("forcePull.button")}
      </button>
      {status === "success" && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-emerald-600 dark:text-emerald-400"
        >
          {t("forcePull.success")}
        </p>
      )}
      {status === "error" && (
        <p
          role="alert"
          aria-live="assertive"
          className="text-sm text-rose-600 dark:text-rose-400"
        >
          {t("forcePull.error")}
        </p>
      )}
    </div>
  );
}
