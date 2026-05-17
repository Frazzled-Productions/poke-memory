"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a numeric value from 0 to `target` over `durationMs` milliseconds
 * using a simple ease-out curve.
 *
 * Returns the current animated value as an integer. When `target` is 0 the
 * hook returns 0 immediately without scheduling any animation.
 *
 * @param target    - The final value to count up to.
 * @param durationMs - Animation duration in milliseconds (default 600).
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [displayed, setDisplayed] = useState(0);
  // Track the last target so we restart animation when the value changes.
  const lastTargetRef = useRef<number>(target);

  useEffect(() => {
    if (target === 0) {
      setDisplayed(0);
      return;
    }

    const startedAt = performance.now();
    const from = lastTargetRef.current === target ? 0 : displayed;
    lastTargetRef.current = target;

    let raf: number;

    function tick(now: number) {
      const elapsed = now - startedAt;
      const progress = Math.min(elapsed / durationMs, 1);
      // Ease-out cubic: decelerate toward the end.
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + eased * (target - from));
      setDisplayed(value);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return displayed;
}
