"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { SignInSheet } from "@/components/auth/SignInSheet";

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
 * The CTA opens the shared SignInSheet (#1669). The previous hand-rolled
 * inline provider picker has been removed in favour of the single sign-in
 * surface.
 */
export function GuestSignUpNudge({ masteredSpecies, practiceSessionsCount }: Props) {
  const t = useTranslations("onboarding");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Do not render until data is loaded.
  if (masteredSpecies === null || practiceSessionsCount === null) return null;

  // Gate: meaningful progress must exist before showing the nudge.
  const thresholdMet =
    masteredSpecies >= GUEST_NUDGE_MASTERED_THRESHOLD ||
    practiceSessionsCount >= GUEST_NUDGE_SESSIONS_THRESHOLD;
  if (!thresholdMet) return null;

  const hasMastered = masteredSpecies >= GUEST_NUDGE_MASTERED_THRESHOLD;

  const bodyText = hasMastered
    ? t("guestSignUpNudge.body", { count: masteredSpecies })
    : t("guestSignUpNudge.bodyLowMastery");

  return (
    <>
      <OnboardingHint
        id="guestSignUpNudgeDismissed"
        title={t("guestSignUpNudge.heading")}
        tone="callout"
        ctaLabel={t("guestSignUpNudge.cta")}
        ctaOnClick={() => setSheetOpen(true)}
      >
        <p>{bodyText}</p>
      </OnboardingHint>
      <SignInSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
