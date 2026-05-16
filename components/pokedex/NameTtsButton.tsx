"use client";

import { speakName } from "@/lib/audio/tts";

interface NameTtsButtonProps {
  name: string;
  id?: number | null;
  /**
   * Visual size variant.
   * - `"reveal"` (default): large standalone button shown next to the revealed
   *   Pokémon name (h-11 w-11, text-xl).
   * - `"inline"`: compact button embedded inside a prompt sentence (h-7 w-7,
   *   text-sm, aligned to the surrounding text baseline).
   */
  size?: "reveal" | "inline";
}

/** Class shared with `REVEAL_SPEAK_BUTTON_CLASS` in the evolution card layout. */
export const REVEAL_SPEAK_BUTTON_CLASS =
  "flex h-11 w-11 items-center justify-center rounded-full text-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

/** Class shared with `INLINE_SPEAK_BUTTON_CLASS` in the evolution card layout. */
export const INLINE_SPEAK_BUTTON_CLASS =
  "ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full align-middle text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

const SIZE_CLASSES: Record<"reveal" | "inline", string> = {
  reveal: REVEAL_SPEAK_BUTTON_CLASS,
  inline: INLINE_SPEAK_BUTTON_CLASS,
};

export function NameTtsButton({ name, id, size = "reveal" }: NameTtsButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Hear ${name}`}
      onClick={() => speakName(name, id)}
      className={SIZE_CLASSES[size]}
    >
      🔊
    </button>
  );
}
