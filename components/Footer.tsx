"use client";

import { useEffect, useState } from "react";

export function Footer() {
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);
  return (
    <footer className="border-t border-zinc-200 bg-background dark:border-zinc-800">
      <div className="mx-auto max-w-5xl px-4 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {year !== null ? `© ${year} Frazzled Productions` : " "}
      </div>
    </footer>
  );
}
