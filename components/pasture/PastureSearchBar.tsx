"use client";

type Props = {
  query: string;
  onChange: (q: string) => void;
};

/**
 * Search bar rendered at the top of the Pasture page.
 * Filters the visible Pokémon by display name (case-insensitive substring).
 */
export function PastureSearchBar({ query, onChange }: Props) {
  return (
    <div className="relative mb-6">
      <label htmlFor="pasture-search" className="sr-only">
        Search Pokémon
      </label>
      <input
        id="pasture-search"
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search Pokémon…"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm text-foreground placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
      />
      {query && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-zinc-400 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
