"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function Footer() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);
  return (
    <footer className="border-t border-zinc-200 bg-background dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
        <span>{year !== null ? `© ${year} Frazzled Productions` : " "}</span>
        <span aria-hidden="true">·</span>
        <Link
          href="/whats-new"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          What&apos;s new
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/privacy"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          Privacy
        </Link>
        <span aria-hidden="true">·</span>
        <span className="font-mono">v{APP_VERSION}</span>
      </div>
      <p className="mx-auto max-w-5xl px-4 pb-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Unofficial fan project — not affiliated with or endorsed by Nintendo,
        Game Freak, or The Pokémon Company. Pokémon and all related names,
        sprites, and cries are the property of their respective owners.
        Sprite and species data sourced from{" "}
        <a
          href="https://pokeapi.co"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          PokéAPI
        </a>
        .
      </p>
    </footer>
  );
}
