"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import {
  hasCloudData,
  applyCloudAuthoritative,
  maxCloudUpdatedAt,
  pullSession,
  pushSession,
} from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import {
  loadSession,
  saveSession,
  bumpSessionStorageKey,
} from "@/lib/review/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import { useSeed } from "@/lib/pokemon/SeedContext";
import {
  hasStoredSettings,
  loadSettings,
  saveSettings,
  type UserSettings,
} from "@/lib/settings/persistence";
import {
  pullUserSettingsRow,
  pullRegionalPrefs,
  pushSettings,
  pushRegionalPrefs,
  type RegionalPrefs,
} from "@/lib/sync/settings";
import { pullStreak, pushStreak } from "@/lib/sync/streak";
import {
  pullGradeLog,
  pushGradeLog,
} from "@/lib/sync/gradeLog";
import {
  loadStreakData,
  saveStreakData,
} from "@/lib/streak/persistence";
import {
  loadGradeLog,
  saveGradeLog,
  type GradeLogEntry,
} from "@/lib/gradelog/persistence";
import { seedOptsFromSettings } from "@/lib/review/seedOpts";
import type { CloudRow } from "@/lib/sync/cloud";
import type { ReviewableCard } from "@/lib/review/session";
import { mutedText } from "@/lib/utils/class-names";
type ConflictData = {
  localCards: ReviewableCard[];
  cloudCards: CloudRow[];
  localStreakCount: number;
  cloudStreakCount: number;
  localGradeLogCount: number;
  cloudGradeLogCount: number;
  // Pre-pulled cloud data so the apply branch doesn't need a second round-trip.
  cloudStreak: string[] | null;
  cloudGradeLog: GradeLogEntry[] | null;
  cloudSettings: UserSettings | null;
  cloudSettingsUpdatedAt: string | null;
  cloudLastResetAt: string | null;
  cloudPrefs: RegionalPrefs | null;
};

type Status =
  | { kind: "loading" }
  | { kind: "conflict"; data: ConflictData }
  | { kind: "error" }
  | { kind: "push-warning"; message: string };

function summariseCards(cards: ReviewableCard[]) {
  const reviewed = cards.filter((c) => c.state.lastReview !== null);
  const latest = reviewed.map((c) => c.state.lastReview as string).sort().at(-1) ?? null;
  return { count: reviewed.length, latest };
}

function summariseCloudCards(rows: CloudRow[]) {
  const reviewed = rows.filter((r) => r.last_review !== null);
  const latest = reviewed.map((r) => r.last_review as string).sort().at(-1) ?? null;
  return { count: reviewed.length, latest };
}

export default function CallbackCompletePage() {
  const router = useRouter();
  const { user, loading, supabase } = useAuth();
  const { anyFlagOn } = useSuperuser();
  const { seed } = useSeed();
  const tAuth = useTranslations("auth");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (seed === null) return;
    if (!user) { router.replace("/"); return; }
    if (!supabase) { router.replace("/"); return; }
    let cancelled = false;
    setStatus({ kind: "loading" });
    async function resolve() {
      if (!supabase || !user) return;
      const localSession = await loadSession();
      const hasLocal =
        localSession !== null &&
        localSession.cards.some((c) => c.state.lastReview !== null);
      let cloudRows: CloudRow[] | null = null;
      try {
        const hasCloud = await hasCloudData(supabase, user.id);
        if (hasCloud) {
          cloudRows = await pullSession(supabase, user.id);
          if (cloudRows === null) {
            if (!cancelled) setStatus({ kind: "error" });
            return;
          }
        }
      } catch {
        if (!cancelled) setStatus({ kind: "error" });
        return;
      }
      if (cancelled) return;
      const cloudHasData = cloudRows !== null && cloudRows.length > 0;
      if (!hasLocal && !cloudHasData) {
        // Brand-new user with no local and no cloud data. Stamp ownerUserId so
        // guardAccountSwitch recognises this device as belonging to this user on
        // the next sign-in. Without this, ownerUserId stays null forever and the
        // guard treats every subsequent sign-in as a guest no-op, blending the
        // prior user's local cards into the new user's cloud on pullAndMerge. (#1712)
        const prev = loadSyncStatus();
        saveSyncStatus({ ...prev, ownerUserId: user.id });
        router.replace("/");
        return;
      }

      // Local cards exist, cloud has no cards → push local cards. Other tables
      // are intentionally NOT pushed in this branch; the per-grade push and
      // AutoSyncOnChange listeners will catch them up on the next user
      // interaction. Keeping this branch narrow avoids a stalled sign-in if
      // any auxiliary push hangs.
      //
      // F11: if any superuser flag is on (or cleanup is pending), skip the push
      // entirely. A guest who applied a QA seed then signs in must not upload
      // fabricated cards to the cloud. The sync write-guard documented in
      // AGENTS.md applies here just as it does for every other write path.
      if (hasLocal && !cloudHasData) {
        if (anyFlagOn) {
          // Write-guard active: navigate away without uploading local state.
          if (!cancelled) router.replace("/");
          return;
        }
        const ok = await pushSession(supabase, user.id, localSession!.cards);
        const prev = loadSyncStatus();
        // Stamp ownerUserId to mark this device's data as belonging to this user
        // (guest-claim path: owner was null, now becomes user.id). (#1712)
        saveSyncStatus({
          ...prev,
          lastPushAt: ok ? new Date().toISOString() : prev.lastPushAt,
          lastPushFailed: !ok,
          lastPushAttemptAt: new Date().toISOString(),
          failedCardCount: ok ? 0 : null,
          ownerUserId: user.id,
        });
        if (!ok && !cancelled) {
          setStatus({ kind: "push-warning", message: "Sync upload failed. Your progress is safe locally." });
          return;
        }
        if (!cancelled) router.replace("/");
        return;
      }
      if (!hasLocal && cloudHasData) {
        // Brand-new device with cloud-only data. Pull everything cloud has
        // and apply it as the truth - no conflict to resolve.
        const [settingsRow, cloudStreak, cloudGradeLog, cloudPrefs] = await Promise.all([
          pullUserSettingsRow(supabase, user.id).catch(() => null),
          pullStreak(supabase, user.id).catch(() => null),
          pullGradeLog(supabase, user.id).catch(() => null),
          pullRegionalPrefs(supabase, user.id).catch(() => null),
        ]);
        if (cancelled) return;
        await applyCloud({
          cloudRows: cloudRows!,
          cloudSettings: settingsRow?.settings ?? null,
          cloudSettingsUpdatedAt: settingsRow?.updatedAt ?? null,
          cloudLastResetAt: settingsRow?.lastResetAt ?? null,
          cloudPrefs,
          cloudStreak,
          cloudGradeLog,
        });
        if (!cancelled) router.replace("/");
        return;
      }
      // Both sides have card data - collect everything needed for the picker
      // before transitioning so neither branch needs another round-trip.
      try {
        const [settingsRow, cloudStreak, cloudGradeLog, cloudPrefs, localStreak, localGradeLog] = await Promise.all([
          pullUserSettingsRow(supabase, user.id).catch(() => null),
          pullStreak(supabase, user.id).catch(() => null),
          pullGradeLog(supabase, user.id).catch(() => null),
          pullRegionalPrefs(supabase, user.id).catch(() => null),
          Promise.resolve(loadStreakData()),
          loadGradeLog(),
        ]);
        if (cancelled) return;
        setStatus({
          kind: "conflict",
          data: {
            localCards: localSession!.cards,
            cloudCards: cloudRows!,
            localStreakCount: localStreak.length,
            cloudStreakCount: cloudStreak?.length ?? 0,
            localGradeLogCount: localGradeLog.length,
            cloudGradeLogCount: cloudGradeLog?.length ?? 0,
            cloudStreak,
            cloudGradeLog,
            cloudSettings: settingsRow?.settings ?? null,
            cloudSettingsUpdatedAt: settingsRow?.updatedAt ?? null,
            cloudLastResetAt: settingsRow?.lastResetAt ?? null,
            cloudPrefs,
          },
        });
      } catch {
        if (!cancelled) setStatus({ kind: "error" });
      }
    }
    void resolve();
    return () => { cancelled = true; };
  }, [loading, user, supabase, router, retryCount, seed]);

  async function applyCloud(data: {
    cloudRows: CloudRow[];
    cloudSettings: UserSettings | null;
    cloudSettingsUpdatedAt: string | null;
    cloudLastResetAt: string | null;
    cloudPrefs: RegionalPrefs | null;
    cloudStreak: string[] | null;
    cloudGradeLog: GradeLogEntry[] | null;
  }) {
    // Apply settings first so the seed opts pick up the cloud-side card-type
    // flags (#391). Regional prefs overlay non-null fields onto the
    // freshly-applied settings.
    if (data.cloudSettings !== null) {
      saveSettings(data.cloudSettings);
    } else if (!hasStoredSettings()) {
      // No cloud settings AND no local settings → leave settings at defaults.
      // saveSession below will run with DEFAULT_SETTINGS opts.
    }
    if (data.cloudPrefs !== null) {
      const local = loadSettings();
      const next = {
        ...local,
        ...(data.cloudPrefs.timezone !== null ? { timezone: data.cloudPrefs.timezone } : {}),
        ...(data.cloudPrefs.dateFormat !== null ? { dateFormat: data.cloudPrefs.dateFormat } : {}),
        ...(data.cloudPrefs.pushNotificationHour !== null
          ? { pushNotificationHour: data.cloudPrefs.pushNotificationHour }
          : {}),
      };
      if (
        next.timezone !== local.timezone ||
        next.dateFormat !== local.dateFormat ||
        next.pushNotificationHour !== local.pushNotificationHour
      ) {
        saveSettings(next);
      }
    }
    const localExisting = await loadSession();
    const settings = loadSettings();
    const opts = seedOptsFromSettings(settings);
    const limits = localExisting?.limits ?? DEFAULT_LIMITS;
    const rebuilt = applyCloudAuthoritative(
      seed?.seedPokemon ?? [],
      seed?.seedEvolutionCards ?? [],
      data.cloudRows,
      opts,
    );
    if (data.cloudStreak !== null) {
      saveStreakData([...data.cloudStreak].sort());
    }
    if (data.cloudGradeLog !== null) {
      await saveGradeLog(data.cloudGradeLog);
    }
    await saveSession({ cards: rebuilt, limits });
    // Advance every cursor so the next background pullAndMerge starts from a
    // non-null anchor (#293 / #577 lesson applied across all tables).
    // Stamp ownerUserId so guardAccountSwitch recognises this device as belonging
    // to this user going forward (guest-claim and keep-cloud paths). (#1712)
    const prev = loadSyncStatus();
    saveSyncStatus({
      ...prev,
      lastPullAt: maxCloudUpdatedAt(data.cloudRows),
      lastSettingsPullAt: data.cloudSettingsUpdatedAt ?? prev.lastSettingsPullAt,
      lastSeenResetAt: data.cloudLastResetAt ?? prev.lastSeenResetAt,
      ownerUserId: user?.id ?? prev.ownerUserId,
    });
    // Wake an open Stats mount (streakDates / gradeLog read on the
    // session-key effect).
    bumpSessionStorageKey();
  }

  async function handleKeepLocal() {
    // F11: write-guard - never push local data while any superuser flag is on.
    // The 'Keep local' button is rendered disabled (see SideCard below) when
    // anyFlagOn is true, but guard here too so the function is safe even if
    // called programmatically.
    if (anyFlagOn) return;
    if (status.kind !== "conflict" || !user || !supabase || pending) return;
    setPending(true);
    try {
      const data = status.data;
      const cardsOk = await pushSession(supabase, user.id, data.localCards);

      // Auxiliary tables are best-effort: a failure shouldn't block the
      // "your local progress is now the source of truth" outcome. We log
      // and continue; the next AutoSyncOnChange event for each table will
      // retry on the next local mutation.
      const localSettings = loadSettings();
      const localStreak = loadStreakData();
      const localGradeLog = await loadGradeLog();
      const auxPushes = await Promise.all([
        pushSettings(supabase, user.id, localSettings).catch((e) => {
          console.warn("[callback-complete] keep-local settings push failed", e);
          return false;
        }),
        pushRegionalPrefs(supabase, user.id, {
          timezone: localSettings.timezone,
          dateFormat: localSettings.dateFormat,
          pushNotificationHour: localSettings.pushNotificationHour,
        }).catch((e) => {
          console.warn("[callback-complete] keep-local regional prefs push failed", e);
          return false;
        }),
        pushStreak(supabase, user.id, localStreak).catch((e) => {
          console.warn("[callback-complete] keep-local streak push failed", e);
          return false;
        }),
        pushGradeLog(supabase, user.id, localGradeLog).catch((e) => {
          console.warn("[callback-complete] keep-local grade-log push failed", e);
          return false;
        }),
      ]);
      void auxPushes;

      const prev = loadSyncStatus();
      // Stamp ownerUserId so guardAccountSwitch recognises this device's data
      // as belonging to this user going forward (keep-local conflict path). (#1712)
      saveSyncStatus({
        ...prev,
        lastPushAt: cardsOk ? new Date().toISOString() : prev.lastPushAt,
        lastPushFailed: !cardsOk,
        lastPushAttemptAt: new Date().toISOString(),
        failedCardCount: cardsOk ? 0 : null,
        ownerUserId: user?.id ?? prev.ownerUserId,
      });
      if (!cardsOk) {
        setStatus({ kind: "push-warning", message: "Sync failed. Your progress is safe locally." });
        return;
      }
      router.replace("/");
    } finally {
      setPending(false);
    }
  }

  function handleKeepCloud() {
    if (status.kind !== "conflict" || pending) return;
    setPending(true);
    void (async () => {
      try {
        const data = status.kind === "conflict" ? status.data : null;
        if (data === null) return;
        await applyCloud({
          cloudRows: data.cloudCards,
          cloudSettings: data.cloudSettings,
          cloudSettingsUpdatedAt: data.cloudSettingsUpdatedAt,
          cloudLastResetAt: data.cloudLastResetAt,
          cloudPrefs: data.cloudPrefs,
          cloudStreak: data.cloudStreak,
          cloudGradeLog: data.cloudGradeLog,
        });
        router.replace("/");
      } catch (err) {
        console.warn("[callback-complete] handleKeepCloud failed:", err);
        setStatus({ kind: "error" });
      } finally {
        setPending(false);
      }
    })();
  }

  if (status.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center" aria-busy="true" aria-label={tAuth("checkingSyncStatusAriaLabel")}>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-foreground" />
          <p className={mutedText}>Checking sync status…</p>
        </div>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-lg font-semibold text-foreground">Could not reach the cloud</p>
          <p className={mutedText}>There was a network error while checking your cloud progress.</p>
          <button type="button" onClick={() => setRetryCount((c) => c + 1)} className="min-h-[44px] rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status.kind === "push-warning") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-lg font-semibold text-foreground">Sync upload failed</p>
          <p className={mutedText}>{status.message}</p>
          <button type="button" onClick={() => router.replace("/")} className="min-h-[44px] rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2">
            Continue
          </button>
        </div>
      </div>
    );
  }

  const localCards = summariseCards(status.data.localCards);
  const cloudCards = summariseCloudCards(status.data.cloudCards);
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-bold text-foreground text-center">Sync conflict</h1>
        <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          You have progress on this device and in the cloud. Picking a side replaces
          the other for all synced data: cards, settings, streak, and grade history.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SideCard
            heading="This device"
            cardCount={localCards.count}
            latestReviewed={localCards.latest}
            streakDays={status.data.localStreakCount}
            gradeEntries={status.data.localGradeLogCount}
            buttonLabel="Keep local"
            buttonClass="bg-foreground text-background hover:opacity-80 focus-visible:ring-foreground"
            disabled={pending}
            superuserPaused={anyFlagOn}
            onClick={handleKeepLocal}
          />
          <SideCard
            heading="Cloud"
            cardCount={cloudCards.count}
            latestReviewed={cloudCards.latest}
            streakDays={status.data.cloudStreakCount}
            gradeEntries={status.data.cloudGradeLogCount}
            buttonLabel="Keep cloud"
            buttonClass="bg-zinc-100 text-zinc-800 hover:bg-zinc-200 focus-visible:ring-zinc-400 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            disabled={pending}
            onClick={handleKeepCloud}
          />
        </div>
      </div>
    </div>
  );
}

function SideCard({
  heading,
  cardCount,
  latestReviewed,
  streakDays,
  gradeEntries,
  buttonLabel,
  buttonClass,
  disabled,
  superuserPaused,
  onClick,
}: {
  heading: string;
  cardCount: number;
  latestReviewed: string | null;
  streakDays: number;
  gradeEntries: number;
  buttonLabel: string;
  buttonClass: string;
  disabled: boolean;
  superuserPaused?: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("auth");
  return (
    <div className="rounded-xl border border-zinc-200 bg-background p-6 dark:border-zinc-800">
      <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      <ul className="mt-2 space-y-1 text-sm text-zinc-500 dark:text-zinc-400">
        <li>
          {t("cardsReviewed", { count: cardCount })}
        </li>
        <li>
          {t("streakDaysCount", { count: streakDays })}
        </li>
        <li>
          {t("gradesLogged", { count: gradeEntries })}
        </li>
      </ul>
      {latestReviewed && (
        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
          Last reviewed: {latestReviewed}
        </p>
      )}
      {/* F11: while any superuser flag is on, replace the push button with
          the standard 'Sync paused (superuser)' treatment so QA-seeded data
          cannot be uploaded to the cloud via the conflict picker. */}
      {superuserPaused ? (
        <button
          type="button"
          disabled
          className="mt-4 w-full min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 bg-foreground text-background"
        >
          Sync paused (superuser)
        </button>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`mt-4 w-full min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 ${buttonClass}`}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  );
}
