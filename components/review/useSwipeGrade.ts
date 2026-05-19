"use client";

/**
 * useSwipeGrade — pointer-event swipe-to-grade hook (#1052).
 *
 * Attaches `pointerdown` / `pointermove` / `pointerup` / `pointercancel`
 * listeners to the element referenced by `targetRef`. While the user is
 * dragging the card it is translated to follow the finger; on release the
 * gesture either commits a grade (if the displacement exceeds the commit
 * threshold) or snaps back to the resting position.
 *
 * The hook is inert:
 *   - Before the card is revealed (`enabled` is `false`).
 *   - While a grade is already in flight (`grading` is `true`).
 *   - When `prefers-reduced-motion: reduce` is set (no drag animation, but
 *     a committed swipe still calls `onGrade` so the interaction remains
 *     usable).
 *
 * Returns `swipeState` so the parent can render a directional hint overlay.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Grade } from "@/lib/review/session";
import {
  resolveSwipe,
  directionToGrade,
  clampOffset,
  COMMIT_THRESHOLD_PX,
} from "@/lib/review/swipeGesture";
import type { SwipeDirection } from "@/lib/review/swipeGesture";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum visual travel (px) before the card stops following the pointer.
 * Kept below COMMIT_THRESHOLD_PX so the card "resists" rather than drifts.
 */
const MAX_VISUAL_OFFSET_PX = 60;

/**
 * Duration (ms) of the snap-back CSS transition.
 * Must match the value in the inline style applied to `targetRef.current`.
 */
const SNAP_BACK_MS = 250;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SwipeState =
  | { active: false }
  | {
      active: true;
      direction: SwipeDirection | null;
      /** True when the primary displacement exceeds COMMIT_THRESHOLD_PX. */
      committed: boolean;
      /** Clamped pixel offsets for the visual drag affordance. */
      offsetX: number;
      offsetY: number;
    };

type Options = {
  /** Ref to the element that will be dragged and receive pointer listeners. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Called with a grade value when a committed swipe is released. */
  onGrade: (grade: Grade) => void;
  /** Swipe grading is gated on card reveal — pass `revealed` here. */
  enabled: boolean;
  /** Inhibit during async grade commit. */
  grading: boolean;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSwipeGrade({
  targetRef,
  onGrade,
  enabled,
  grading,
}: Options): { swipeState: SwipeState } {
  const [swipeState, setSwipeState] = useState<SwipeState>({ active: false });

  // Stable refs so pointer handlers don't recreate on every render.
  const onGradeRef = useRef(onGrade);
  onGradeRef.current = onGrade;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const gradingRef = useRef(grading);
  gradingRef.current = grading;

  // Track per-gesture origin so we can compute deltas in pointermove.
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const pointerId = useRef<number | null>(null);

  // Detect `prefers-reduced-motion` once at hook mount.
  const reducedMotion =
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  const applyTransform = useCallback(
    (dx: number, dy: number, transition = "") => {
      const el = targetRef.current;
      if (!el) return;
      if (reducedMotion) return; // never animate under reduced-motion
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.transition = transition;
    },
    [targetRef, reducedMotion],
  );

  const resetTransform = useCallback(
    (animate: boolean) => {
      const el = targetRef.current;
      if (!el) return;
      el.style.transform = "";
      el.style.transition = animate && !reducedMotion
        ? `transform ${SNAP_BACK_MS}ms cubic-bezier(0.34,1.56,0.64,1)`
        : "";
      // Clear the transition property after the animation completes so it
      // does not interfere with other CSS transitions on the element.
      if (animate && !reducedMotion) {
        const tid = setTimeout(() => {
          if (targetRef.current) {
            targetRef.current.style.transition = "";
          }
        }, SNAP_BACK_MS);
        return () => clearTimeout(tid);
      }
    },
    [targetRef, reducedMotion],
  );

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    function onPointerDown(e: PointerEvent) {
      if (!enabledRef.current || gradingRef.current) return;
      // Only respond to primary pointer (ignore multi-touch, stylus hover, etc.).
      if (!e.isPrimary) return;

      originRef.current = { x: e.clientX, y: e.clientY };
      pointerId.current = e.pointerId;
      el!.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (!enabledRef.current || gradingRef.current) return;
      if (originRef.current === null || e.pointerId !== pointerId.current) return;

      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;

      const resolved = resolveSwipe(dx, dy);

      // Visual feedback — clamp so the card does not drift off-screen.
      const clampedX = clampOffset(dx, MAX_VISUAL_OFFSET_PX);
      const clampedY = clampOffset(dy, MAX_VISUAL_OFFSET_PX);

      // Only translate along the primary axis to keep the motion clean.
      let visualX = 0;
      let visualY = 0;
      if (resolved !== null) {
        if (resolved.direction === "left" || resolved.direction === "right") {
          visualX = clampedX;
        } else {
          visualY = clampedY;
        }
      }

      applyTransform(visualX, visualY);

      setSwipeState({
        active: true,
        direction: resolved?.direction ?? null,
        committed: resolved?.committed ?? false,
        offsetX: visualX,
        offsetY: visualY,
      });
    }

    function endGesture(e: PointerEvent, cancelled: boolean) {
      if (originRef.current === null || e.pointerId !== pointerId.current) return;

      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;

      originRef.current = null;
      pointerId.current = null;

      const resolved = !cancelled ? resolveSwipe(dx, dy) : null;

      resetTransform(true);
      setSwipeState({ active: false });

      if (resolved?.committed && enabledRef.current && !gradingRef.current) {
        const grade = directionToGrade(resolved.direction);
        onGradeRef.current(grade);
      }
    }

    function onPointerUp(e: PointerEvent) {
      endGesture(e, false);
    }

    function onPointerCancel(e: PointerEvent) {
      endGesture(e, true);
    }

    // `touch-action: none` is required on the element so the browser does not
    // also initiate a scroll while we're capturing the pointer. We set it via
    // JS so the element keeps its default value when the hook is inactive and
    // we don't have to add a Tailwind class to the parent.
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      // Restore defaults on cleanup.
      el.style.touchAction = "";
      el.style.transform = "";
      el.style.transition = "";
    };
  }, [targetRef, applyTransform, resetTransform]);
  // `enabled` and `grading` are read via stable refs (updated every render)
  // so they don't need to be in deps — the listener re-registers only when
  // the element ref changes (e.g. card type switch mounts a new element).

  return { swipeState };
}
