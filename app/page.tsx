import { ReviewSession } from "@/components/review/ReviewSession";
import { StreakBadge } from "@/components/review/StreakBadge";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-12 sm:py-16">
      {error === "auth" && (
        <div className="mb-6 w-full max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Sign-in failed. Please try again.
        </div>
      )}
      <main className="w-full max-w-md">
        <StreakBadge />
        <ReviewSession />
      </main>
    </div>
  );
}
