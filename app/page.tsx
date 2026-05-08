import { ReviewSession } from "@/components/review/ReviewSession";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-12 sm:py-16">
      <main className="w-full max-w-md">
        <ReviewSession />
      </main>
    </div>
  );
}
