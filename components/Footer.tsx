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
        <span className="font-mono">v{APP_VERSION}</span>
      </div>
    </footer>
  );
}
