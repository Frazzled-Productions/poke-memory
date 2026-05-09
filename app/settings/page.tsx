"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";
import { loadCloudSync } from "@/lib/sync/actions";
import { loadSession } from "@/lib/review/persistence";
import { loadStreakData } from "@/lib/streak/persistence";
import { ConflictPicker } from "@/components/sync/ConflictPicker";
import type { CloudSyncPayload } from "@/lib/sync/types";

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading settings">
      <SkeletonBlock className="h-20 w-full" />
      <SkeletonBlock className="h-20 w-full" />
      <SkeletonBlock className="h-20 w-full" />
    </div>
  );
}

type FieldConfig = {
  key: keyof UserSettings;
  label: string;
  helper: string;
  min: number;
  max: number;
};

const FIELDS: FieldConfig[] = [
  {
    key: "masteryRepetitions",
    label: "Mastery threshold",
    helper: "Cards with this many consecutive correct reviews count as mastered.",
    min: 1,
    max: 10,
  },
  {
    key: "maxNewPerDay",
    label: "New cards per day",
    helper: "Hard daily cap. Raising this grows tomorrow's review pile faster.",
    min: 1,
    max: 50,
  },
  {
    key: "maxReviewsPerDay",
    label: "Reviews per day",
    helper: "Soft cap — you can always override it during a session.",
    min: 1,
    max: 500,
  },
];

type ConflictState = {
  localPayload: CloudSyncPayload;
  cloudPayload: CloudSyncPayload;
};

function SyncAccountSection() {
  const { data: session, status } = useSession();
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const prevStatusRef = useRef<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prevStatus === status || status !== "authenticated") return;

    void (async () => {
      const cloudPayload = await loadCloudSync();
      if (cloudPayload === null) return;
      const localSession = loadSession();
      if (localSession === null) return;
      const localPayload: CloudSyncPayload = {
        session: localSession,
        streak: loadStreakData(),
        settings: loadSettings(),
        syncedAt: new Date().toISOString(),
      };
      setConflict({ localPayload, cloudPayload });
    })();
  }, [status]);

  if (status === "loading") {
    return (
      <div
        className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800"
        aria-busy="true"
        aria-label="Loading account status"
      >
        <div className="flex flex-col gap-3">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (status === "unauthenticated" || session === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <p className="text-sm font-medium text-foreground">Sync account</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Sign in with GitHub to sync your progress across devices.
        </p>
        <button
          type="button"
          onClick={() => void signIn("github")}
          className="mt-3 min-h-[44px] rounded-lg bg-foreground px-8 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  return (
    <>
      {conflict !== null && (
        <ConflictPicker
          localPayload={conflict.localPayload}
          cloudPayload={conflict.cloudPayload}
          onResolved={() => setConflict(null)}
        />
      )}
      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <p className="text-sm font-medium text-foreground">Sync account</p>
        <div className="mt-3 flex items-center gap-3">
          {session.user?.image !== null && session.user?.image !== undefined && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-full border border-zinc-200 dark:border-zinc-700"
            />
          )}
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold text-foreground">
              {session.user?.name ?? session.user?.email ?? "GitHub user"}
            </p>
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              Signed in
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Your review progress, streak, and settings sync to the cloud and are
          available on all your devices.
        </p>
        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: "/settings" })}
          className="mt-3 min-h-[44px] rounded-lg bg-zinc-100 px-8 py-2 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          Sign out
        </button>
      </div>
    </>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    return () => {
      if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  function handleChange(key: keyof UserSettings, raw: string) {
    if (settings === null) return;
    const value = parseInt(raw, 10);
    setSettings({ ...settings, [key]: isNaN(value) ? settings[key] : value });
  }

  function handleSave() {
    if (settings === null) return;
    const clamped = Object.fromEntries(
      FIELDS.map(({ key, min, max }) => [key, Math.max(min, Math.min(max, settings[key]))])
    ) as UserSettings;
    saveSettings(clamped);
    setSettings(clamped);
    setSaved(true);
    if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(() => {
      savedTimeoutRef.current = null;
      setSaved(false);
    }, 2000);
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-3xl">
        <h1 className="mb-8 text-2xl font-bold tracking-tight text-foreground">
          Settings
        </h1>

        <div className="flex flex-col gap-4">
          <SyncAccountSection />

          {settings === null ? (
            <LoadingSkeleton />
          ) : (
            <>
              {FIELDS.map(({ key, label, helper, min, max }) => (
                <div
                  key={key}
                  className="rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800"
                >
                  <label
                    htmlFor={key}
                    className="block text-sm font-medium text-foreground"
                  >
                    {label}
                  </label>
                  <input
                    id={key}
                    type="number"
                    min={min}
                    max={max}
                    step={1}
                    value={settings[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700"
                  />
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {helper}
                  </p>
                </div>
              ))}

              <div className="flex items-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={handleSave}
                  className="min-h-[44px] rounded-lg bg-foreground px-8 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
                >
                  Save
                </button>
                {saved && (
                  <p
                    className="text-sm font-medium text-emerald-600 dark:text-emerald-400"
                    aria-live="polite"
                  >
                    Saved!
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
