"use client";

import { playCry } from "@/lib/audio/cry";

interface CryButtonProps {
  cryUrl: string | null;
  label: string;
}

const BUTTON_CLASS =
  "flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";

export function CryButton({ cryUrl, label }: CryButtonProps) {
  if (!cryUrl) return null;

  return (
    <button
      type="button"
      aria-label={`Play ${label} cry`}
      onClick={() => playCry(cryUrl)}
      className={BUTTON_CLASS}
    >
      <span aria-hidden="true">🎵</span>
      Play cry
    </button>
  );
}
