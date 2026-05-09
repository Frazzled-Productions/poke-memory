"use client";

import { useState } from "react";
import { resolveConflict } from "@/lib/sync/actions";
import { saveSession } from "@/lib/review/persistence";
import { saveStreakData } from "@/lib/streak/persistence";
import { saveSettings } from "@/lib/settings/persistence";
import type { CloudSyncPayload } from "@/lib/sync/types";

type ConflictPickerProps = {
  localPayload: CloudSyncPayload;
  cloudPayload: CloudSyncPayload;
  onResolved: () => void;
};

function formatDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      role="status"
      aria-label="Loading"
    />
  );
}

export function ConflictPicker({
  localPayload,
  cloudPayload,
  onResolved,
}: ConflictPickerProps) {
  const [loading, setLoading] = useState<"local" | "cloud" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePick(resolution: "local" | "cloud") {
    if (loading !== null) return;
    setLoading(resolution);
    setError(null);
    try {
      const winner = await resolveConflict(resolution, localPayload);
      saveSession(winner.session);
      saveStreakData(winner.streak);
      saveSettings(winner.settings);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-picker-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-background px-6 py-6 shadow-xl dark:border-zinc-800">
        <h2
          id="conflict-picker-title"
          className="mb-2 text-lg font-bold text-foreground"
        >
          Sync conflict
        </h2>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          You have review progress saved both locally and in the cloud. Choose
          which data to keep. The other will be discarded.
        </p>

        {error !== null && (
          <p
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Local option */}
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-foreground">This device</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Last saved {formatDate(localPayload.syncedAt)}
              </p>
            </div>
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => void handlePick("local")}
              className="min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading === "local" ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Applying…
                </span>
              ) : (
                "Keep local"
              )}
            </button>
          </div>

          {/* Cloud option */}
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
            <div>
              <p className="text-sm font-semibold text-foreground">Cloud</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Last saved {formatDate(cloudPayload.syncedAt)}
              </p>
            </div>
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => void handlePick("cloud")}
              className="min-h-[44px] rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              {loading === "cloud" ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Applying…
                </span>
              ) : (
                "Use cloud"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
