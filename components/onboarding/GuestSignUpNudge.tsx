"use client";

import { useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth/actions";
import type { AuthProvider } from "@/lib/auth/types";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";

/** Minimum mastered-species count to trigger the nudge (#1668). */
export const GUEST_NUDGE_MASTERED_THRESHOLD = 10;

/** Minimum completed-sessions count to trigger the nudge (#1668). */
export const GUEST_NUDGE_SESSIONS_THRESHOLD = 3;

type Props = {
  /**
   * Mastered-species count for the current guest. Derived from the page's
   * snapshot (`snapshot.mastery.mastered` on Stats, `masterySnapshot.mastered`
   * on Journey). Pass `null` while the snapshot is still loading - the nudge
   * renders nothing until both values are known.
   */
  masteredSpecies: number | null;
  /**
   * Number of completed practice sessions, read from
   * `settings.onboarding.practiceSessionsCount`. Pass `null` while settings
   * are still loading.
   */
  practiceSessionsCount: number | null;
};

/**
 * One-shot loss-aversion nudge shown on Stats and Journey pages for guests
 * who have real progress worth protecting (#1668). Renders only when:
 *
 * - The user is a guest (this component must only be rendered when `user`
 *   from `useAuth()` is null - the parent gates on that before rendering).
 * - Data has loaded (`masteredSpecies !== null && practiceSessionsCount !== null`).
 * - Progress threshold met: `masteredSpecies >= 10 OR practiceSessionsCount >= 3`.
 * - The flag `guestSignUpNudgeDismissed` is still false.
 *
 * The CTA opens an inline sign-in provider picker. A dedicated sign-in sheet
 * is handled by #1669 - this component uses the minimal existing affordance.
 */
export function GuestSignUpNudge({ masteredSpecies, practiceSessionsCount }: Props) {
  const t = useTranslations("onboarding");
  const tAuth = useTranslations("auth");
  const [isPending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Do not render until data is loaded.
  if (masteredSpecies === null || practiceSessionsCount === null) return null;

  // Gate: meaningful progress must exist before showing the nudge.
  const thresholdMet =
    masteredSpecies >= GUEST_NUDGE_MASTERED_THRESHOLD ||
    practiceSessionsCount >= GUEST_NUDGE_SESSIONS_THRESHOLD;
  if (!thresholdMet) return null;

  const hasMastered = masteredSpecies >= GUEST_NUDGE_MASTERED_THRESHOLD;

  function handleSignIn(provider: AuthProvider) {
    setPickerOpen(false);
    startTransition(() => signIn(provider));
  }

  const ctaContent = pickerOpen ? (
    <div className="mt-3 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => handleSignIn("github")}
        disabled={isPending}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-zinc-200 bg-background px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {tAuth("continueWithGitHub")}
      </button>
      <button
        type="button"
        onClick={() => handleSignIn("google")}
        disabled={isPending}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-zinc-200 bg-background px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {tAuth("continueWithGoogle")}
      </button>
    </div>
  ) : undefined;

  const bodyText = hasMastered
    ? t("guestSignUpNudge.body", { count: masteredSpecies })
    : t("guestSignUpNudge.bodyLowMastery");

  return (
    <OnboardingHint
      id="guestSignUpNudgeDismissed"
      title={t("guestSignUpNudge.heading")}
      tone="callout"
      ctaLabel={pickerOpen ? undefined : t("guestSignUpNudge.cta")}
      ctaOnClick={pickerOpen ? undefined : () => setPickerOpen(true)}
    >
      <p>{bodyText}</p>
      {ctaContent}
    </OnboardingHint>
  );
}
