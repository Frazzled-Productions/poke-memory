"use client";

import { useId } from "react";
import { colStack } from "@/lib/utils/class-names";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Number of matching sections — used for the aria-live status message. */
  matchCount: number;
};

/**
 * Search/filter input pinned at the top of the Settings page.
 * Announces the result count to screen-readers via aria-live.
 */
export function SettingsSearch({ value, onChange, matchCount }: Props) {
  const inputId = useId();
  const statusId = useId();
  const isFiltering = value.trim().length > 0;

  return (
    <div className={colStack}>
      <label htmlFor={inputId} className="sr-only">
        Search settings
      </label>
      <div className="relative">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clipRule="evenodd"
          />
        </svg>
        <input
          id={inputId}
          type="search"
          aria-label="Search settings"
          placeholder="Search settings…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={[
            "w-full rounded-xl border bg-background py-2.5 pl-9 pr-4 text-sm text-foreground",
            "placeholder:text-zinc-400 dark:placeholder:text-zinc-500",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2",
            "border-zinc-200 dark:border-zinc-800",
          ].join(" ")}
        />
        {isFiltering && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        )}
      </div>
      {/* aria-live region — announces result count when the query changes */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {isFiltering
          ? matchCount === 0
            ? "No settings match your search."
            : `${matchCount} section${matchCount === 1 ? "" : "s"} ${matchCount === 1 ? "matches" : "match"} your search.`
          : ""}
      </p>
    </div>
  );
}
