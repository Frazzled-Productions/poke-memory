"use client";

import { speakName } from "@/lib/audio/tts";

interface NameTtsButtonProps {
  name: string;
}

const BUTTON_CLASS =
  "flex h-11 w-11 items-center justify-center rounded-full text-xl text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

export function NameTtsButton({ name }: NameTtsButtonProps) {
  return (
    <button
      type="button"
      aria-label={`Hear ${name}`}
      onClick={() => speakName(name)}
      className={BUTTON_CLASS}
    >
      🔊
    </button>
  );
}
