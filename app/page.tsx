import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { ReviewSession } from "@/components/review/ReviewSession";
import { PracticeSidebar } from "@/components/review/PracticeSidebar";
import { StreakBadge } from "@/components/review/StreakBadge";

export const metadata: Metadata = {
  title: "Poké Memory - Learn every Pokémon",
  description:
    "Free spaced-repetition flashcards for learning all 1025 Pokémon names and evolutions. No sign-up required.",
};

async function AuthErrorBanner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (error !== "auth") return null;
  return (
    <div
      role="alert"
      className="mb-6 w-full max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      Sign-in failed. Please try again.
    </div>
  );
}

// Home stays synchronous and forwards searchParams to AuthErrorBanner — awaiting
// searchParams here would pull the suspend point up to the page root and break
// prerender under cacheComponents.
export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    /*
      On mobile the page must fill the available height between the top nav and
      the bottom nav without scrolling (#1087). The height chain is:
        body (flex flex-col min-h-dvh)            ← anchors page to 100dvh (#1086)
        → MobileNavPaddingWrapper (flex-1 flex-col min-h-0)
        → this div (flex-1 flex-col min-h-0) ← fills the gap
        → inner container → main → ReviewSession wrapper
      `min-h-0` prevents the flex child from overflowing its parent when the
      session content is taller than the available space (flex's default is
      min-height: auto which lets children overflow).
      On sm+ (>= 640 px) the layout reverts to a scrollable centred column
      with `sm:items-center sm:py-16`.
    */
    <div className="flex flex-1 flex-col min-h-0 bg-background px-4 pt-2 sm:items-center sm:py-16">
      <Suspense fallback={null}>
        {/*
          AuthErrorBanner needs the full viewport width at the top — render it
          outside the constrained inner container so it can take `max-w-md`.
        */}
        <AuthErrorBanner searchParams={searchParams} />
      </Suspense>

      {/*
        At lg: the layout shifts to a three-column grid:
          - left gutter (empty, mirrors the sidebar width)
          - centre column: the card review session, constrained to md width
          - right column: the session-progress sidebar

        On mobile and tablet the grid collapses to a single column and the
        sidebar is hidden. The sidebar shows session-local counters only (grades
        reviewed today, accuracy, recent grade dots) — not mastery/completion
        state — so it is unaffected by the `pretendAllMastered` superuser flag.

        `flex-1 flex-col min-h-0` continues the height chain on mobile so that
        ReviewSession fills the remaining space and places grade buttons on screen.
        `lg:flex-none` releases the flex growth at the lg breakpoint where the
        three-column grid takes over.
      */}
      <div className="flex flex-1 flex-col min-h-0 w-full max-w-md lg:max-w-5xl lg:flex-none lg:grid lg:grid-cols-[1fr_min(448px,100%)_1fr] lg:gap-8 lg:items-start">
        {/* Left gutter — empty on lg+, keeps the card centred */}
        <div className="hidden lg:block" aria-hidden="true" />

        {/* Main review session — always visible */}
        <main className="flex flex-1 flex-col min-h-0 w-full lg:flex-none">
          <div className="mb-2 sm:mb-4">
            <OnboardingHint
              id="welcomeDismissed"
              tone="callout"
              title="Welcome to Poké Memory"
              ctaHref="/settings#onboarding-heading"
              ctaLabel="How this works"
            >
              Learn every Pokémon&apos;s name and evolutions with spaced
              repetition. Grade honestly: the app shows each card right before
              you&apos;d likely forget it, so gaps grow as you remember.
            </OnboardingHint>
          </div>
          <StreakBadge />
          {/*
            Wrapper propagates the remaining height into ReviewSession on mobile
            so the grade buttons stay on screen without scrolling (#1087).
          */}
          <div className="flex flex-1 flex-col min-h-0">
            <ReviewSession />
          </div>
        </main>

        {/* Session progress sidebar — visible only at lg+, hidden on mobile/tablet */}
        <div className="hidden lg:block lg:pt-0">
          <div className="sticky top-6">
            <PracticeSidebar />
          </div>
        </div>
      </div>
    </div>
  );
}
