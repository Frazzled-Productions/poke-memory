"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DEFAULT_ONBOARDING,
  SETTINGS_SAVED_EVENT,
  loadSettings,
  saveSettings,
  type OnboardingFlags,
} from "@/lib/settings/persistence";

type Tone = "hint" | "callout";

type Props = {
  id: keyof OnboardingFlags;
  /** Optional bold lead displayed above the body. */
  title?: string;
  children: React.ReactNode;
  /** Optional CTA link rendered as a primary button. */
  ctaHref?: string;
  ctaLabel?: string;
  /**
   * Optional CTA action rendered as a primary button. Use instead of `ctaHref`
   * when the call-to-action triggers an in-page action (e.g. expanding a
   * collapsible) rather than navigating to a URL.
   */
  ctaOnClick?: () => void;
  /**
   * `"hint"` = inline tip (default). `"callout"` = larger card used for the
   * home-page welcome message.
   */
  tone?: Tone;
};

const TONE_CLASSES: Record<Tone, string> = {
  hint: "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900",
  callout:
    "border-[var(--theme-secondary)] bg-surface-raised shadow-sm",
};

export function OnboardingHint({
  id,
  title,
  children,
  ctaHref,
  ctaLabel,
  ctaOnClick,
  tone = "hint",
}: Props) {
  // `null` until we've read localStorage. Rendering `null` during the first
  // paint avoids a flash of the hint on dismissed surfaces; the brief delay
  // is only the time it takes for `useEffect` to run after hydration.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = () => {
      const settings = loadSettings();
      // Defensive: stub-mocked settings in unrelated tests may omit `onboarding`.
      setDismissed(settings.onboarding?.[id] ?? false);
    };
    sync();
    // Pick up resets and cross-surface dismissals from the same tab. The
    // SETTINGS_SAVED_EVENT is dispatched by `saveSettings` on every write.
    window.addEventListener(SETTINGS_SAVED_EVENT, sync);
    return () => {
      window.removeEventListener(SETTINGS_SAVED_EVENT, sync);
    };
  }, [id]);

  if (dismissed !== false) return null;

  function handleDismiss() {
    const settings = loadSettings();
    // Defensive: stub-mocked or pre-#433 settings may omit `onboarding`.
    // DEFAULT_ONBOARDING is the canonical full shape, so spreading from it
    // keeps any flag added later (e.g. #702) present after a dismissal.
    const onboarding = settings.onboarding ?? { ...DEFAULT_ONBOARDING };
    saveSettings({
      ...settings,
      onboarding: { ...onboarding, [id]: true },
    });
    setDismissed(true);
  }

  const padding = tone === "callout" ? "px-5 py-4" : "px-4 py-3";
  const titleClass =
    tone === "callout"
      ? "text-base font-semibold text-foreground"
      : "text-sm font-semibold text-foreground";
  const bodyClass =
    tone === "callout"
      ? "mt-1 text-sm text-zinc-600 dark:text-zinc-300"
      : "mt-0.5 text-xs text-zinc-600 dark:text-zinc-400";

  return (
    <div
      role="note"
      aria-label={title ?? "Onboarding hint"}
      className={`relative w-full rounded-xl border ${padding} ${TONE_CLASSES[tone]}`}
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss hint"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <span aria-hidden="true">×</span>
      </button>
      <div className="pr-8">
        {title && <p className={titleClass}>{title}</p>}
        <div className={bodyClass}>{children}</div>
        {ctaOnClick && ctaLabel ? (
          <button
            type="button"
            onClick={ctaOnClick}
            className="mt-3 inline-flex min-h-[36px] items-center rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
          >
            {ctaLabel}
          </button>
        ) : (
          ctaHref &&
          ctaLabel && (
            <Link
              href={ctaHref}
              className="mt-3 inline-flex min-h-[36px] items-center rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              {ctaLabel}
            </Link>
          )
        )}
      </div>
    </div>
  );
}
