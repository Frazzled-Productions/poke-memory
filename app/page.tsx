import { ReviewSession } from "@/components/review/ReviewSession";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-12 sm:py-16">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          poke-memory
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Spaced-repetition Pokémon flashcards
        </p>
      </header>

      <main className="w-full max-w-md">
        <ReviewSession />
      </main>
    </div>
  );
}
