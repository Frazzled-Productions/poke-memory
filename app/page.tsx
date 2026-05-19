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
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-4 sm:py-16">
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
      */}
      <div className="w-full max-w-md lg:max-w-5xl lg:grid lg:grid-cols-[1fr_min(448px,100%)_1fr] lg:gap-8 lg:items-start">
        {/* Left gutter — empty on lg+, keeps the card centred */}
        <div className="hidden lg:block" aria-hidden="true" />

        {/* Main review session — always visible */}
        <main className="w-full">
          <div className="mb-4">
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
          <ReviewSession />
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
