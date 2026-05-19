"use client";

/**
 * SwipeHint — directional overlay shown while the user is actively dragging
 * a flip card in a swipe-to-grade gesture (#1052).
 *
 * Displays a grade label (e.g. "Good →" or "← Again") that tracks the swipe
 * direction and increases in opacity when the commit threshold is crossed.
 *
 * Purely decorative: `aria-hidden="true"` so screen-reader users are unaffected.
 * The grade still commits on pointer release even when the user prefers reduced
 * motion — the animation is suppressed but the interaction is preserved.
 */

import type { SwipeState } from "@/components/review/useSwipeGrade";
import type { SwipeDirection } from "@/lib/review/swipeGesture";

type LabelMap = Record<SwipeDirection, string>;

const LABEL_MAP: LabelMap = {
  right: "Good",
  left: "Again",
  up: "Easy",
  down: "Hard",
};

const COLOUR_MAP: LabelMap = {
  right: "bg-emerald-600 text-white",
  left: "bg-red-500 text-white",
  up: "bg-sky-500 text-white",
  down: "bg-amber-500 text-white",
};

const ARROW_MAP: LabelMap = {
  right: "→",
  left: "←",
  up: "↑",
  down: "↓",
};

type Props = {
  swipeState: SwipeState;
};

export function SwipeHint({ swipeState }: Props) {
  if (!swipeState.active || swipeState.direction === null) return null;

  const { direction, committed } = swipeState;

  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl",
        "transition-opacity duration-100",
        committed ? "opacity-90" : "opacity-40",
      ].join(" ")}
    >
      <span
        className={[
          "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold shadow-lg",
          COLOUR_MAP[direction],
        ].join(" ")}
      >
        <span className="text-base leading-none" aria-hidden="true">
          {ARROW_MAP[direction]}
        </span>
        {LABEL_MAP[direction]}
      </span>
    </div>
  );
}
