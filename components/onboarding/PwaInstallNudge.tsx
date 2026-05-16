"use client";

import { useEffect, useState } from "react";
import {
  SETTINGS_SAVED_EVENT,
  loadSettings,
  saveSettings,
} from "@/lib/settings/persistence";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";

const VISIT_SESSION_KEY = "poke-memory:visit-counted:v1";
const VISIT_THRESHOLD = 3;

export function PwaInstallNudge() {
  const installState = useInstallPrompt();
  // `dismissed` stays null until the first read so the nudge never flashes
  // before localStorage is known.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [visitCount, setVisitCount] = useState(0);

  // A single effect increments the per-session visit count and then reads
  // both pieces of state, so `dismissed` and `visitCount` always land in the
  // same commit — no intermediate render where one is stale.
  useEffect(() => {
    if (!sessionStorage.getItem(VISIT_SESSION_KEY)) {
      sessionStorage.setItem(VISIT_SESSION_KEY, "1");
      const settings = loadSettings();
      saveSettings({
        ...settings,
        appVisitCount: (settings.appVisitCount ?? 0) + 1,
      });
    }
    function sync() {
      const settings = loadSettings();
      setDismissed(settings.onboarding?.installNudgeDismissed ?? false);
      setVisitCount(settings.appVisitCount ?? 0);
    }
    sync();
    window.addEventListener(SETTINGS_SAVED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, sync);
  }, []);

  function handleDismiss() {
    const settings = loadSettings();
    const next = {
      ...settings,
      onboarding: { ...settings.onboarding, installNudgeDismissed: true },
    };
    saveSettings(next);
    setDismissed(true);
  }

  async function handleInstall() {
    if (installState.platform !== "android") return;
    try {
      const { outcome } = await installState.prompt();
      if (outcome === "accepted") {
        handleDismiss();
      }
    } catch {
      // prompt() rejects if the deferred event was already consumed; leave
      // the nudge in place so the user can retry.
    }
  }

  if (
    dismissed !== false ||
    visitCount < VISIT_THRESHOLD ||
    installState.platform === "already-installed" ||
    installState.platform === "unsupported"
  ) {
    return null;
  }

  return (
    <div
      role="note"
      aria-label="Install Poké Memory"
      className="relative mx-auto w-full max-w-md rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss install nudge"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <span aria-hidden="true">×</span>
      </button>
      <div className="pr-8">
        <p className="text-sm font-semibold text-foreground">
          Install Poké Memory
        </p>
        {installState.platform === "android" ? (
          <>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Add to your home screen for quick access — no app store needed.
            </p>
            <button
              type="button"
              onClick={handleInstall}
              className="mt-3 inline-flex min-h-[36px] items-center rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              Install app
            </button>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>{" "}
            to install.
          </p>
        )}
      </div>
    </div>
  );
}
