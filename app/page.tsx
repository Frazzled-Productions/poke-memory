import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { ReviewSession } from "@/components/review/ReviewSession";
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
        <AuthErrorBanner searchParams={searchParams} />
      </Suspense>
      <main className="w-full max-w-md">
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
    </div>
  );
}
