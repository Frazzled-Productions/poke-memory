/**
 * swipeGesture - pure geometry helpers for swipe-to-grade gestures.
 *
 * Kept in `lib/` so these functions can be tested in the `node` vitest project
 * (no DOM required). The React hook that wires them to pointer events lives in
 * `components/review/useSwipeGrade.ts`.
 *
 * Gesture mapping (from issue #1052):
 *   Right  → Good  (4)
 *   Left   → Again (1)
 *   Up     → Easy  (5)
 *   Down   → Hard  (2)
 *
 * A swipe only commits when the displacement exceeds `COMMIT_THRESHOLD_PX` in
 * one axis and the angle from horizontal/vertical is within `MAX_DIAGONAL_DEG`.
 * This prevents accidental grades when the user is scrolling or making small
 * directional adjustments.
 */

import type { Grade } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum displacement (px) before a swipe registers as a commit. */
export const COMMIT_THRESHOLD_PX = 80;

/**
 * Maximum angle (degrees) from the primary axis before the gesture is
 * considered too diagonal and is ignored.
 *
 * At 45° the axes are ambiguous; we require < 40° to be more lenient.
 */
export const MAX_DIAGONAL_DEG = 40;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four swipe directions that map to grades. */
export type SwipeDirection = "right" | "left" | "up" | "down";

/**
 * Swipe progress during an active drag.
 * Both deltas are in CSS pixels and may be negative.
 */
export type SwipeDelta = { dx: number; dy: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the swipe direction and whether it has reached the commit threshold.
 *
 * Returns `null` when:
 *   - Neither axis exceeds the minimum displacement needed to determine direction.
 *   - The motion is too diagonal (angle ≥ MAX_DIAGONAL_DEG from both axes).
 */
export function resolveSwipe(
  dx: number,
  dy: number,
): { direction: SwipeDirection; committed: boolean } | null {
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  // Need at least some displacement to resolve direction.
  if (absDx < 1 && absDy < 1) return null;

  // Compute angle from the horizontal axis (0° = purely horizontal).
  const angleFromHorizontalDeg = (Math.atan2(absDy, absDx) * 180) / Math.PI;

  // Reject if too diagonal: angle must be clearly closer to one axis.
  const angleFromVerticalDeg = 90 - angleFromHorizontalDeg;
  if (
    angleFromHorizontalDeg >= MAX_DIAGONAL_DEG &&
    angleFromVerticalDeg >= MAX_DIAGONAL_DEG
  ) {
    return null;
  }

  const isHorizontal = absDx >= absDy;

  let direction: SwipeDirection;
  let primaryDisplacement: number;

  if (isHorizontal) {
    direction = dx > 0 ? "right" : "left";
    primaryDisplacement = absDx;
  } else {
    direction = dy > 0 ? "down" : "up";
    primaryDisplacement = absDy;
  }

  return {
    direction,
    committed: primaryDisplacement >= COMMIT_THRESHOLD_PX,
  };
}

/**
 * Maps a committed swipe direction to an FSRS grade value.
 *
 * Right → Good (4), Left → Again (1), Up → Easy (5), Down → Hard (2).
 */
export function directionToGrade(direction: SwipeDirection): Grade {
  const map: Record<SwipeDirection, Grade> = {
    right: 4,
    left: 1,
    up: 5,
    down: 2,
  };
  return map[direction];
}

/**
 * Clamps the visual offset for the drag affordance so the card does not
 * travel further than `maxPx` pixels from its resting position.
 *
 * The cap is intentionally less than `COMMIT_THRESHOLD_PX` so the card
 * visually "resists" near the threshold edge rather than floating away.
 */
export function clampOffset(value: number, maxPx: number): number {
  return Math.max(-maxPx, Math.min(maxPx, value));
}
