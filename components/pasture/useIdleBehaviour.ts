"use client";

/**
 * useIdleBehaviour — drives Pasture sprite idle animation (#402).
 *
 * Runs a single requestAnimationFrame loop that throttles per-sprite updates
 * to ~8 Hz via TICK_INTERVAL_MS. CSS transforms are written directly to DOM
 * elements so React never re-renders during motion.
 *
 * Pauses automatically when:
 *   - The zone is scrolled out of viewport (IntersectionObserver).
 *   - The browser tab is hidden (visibilitychange).
 *   - OS "Reduce Motion" preference is on (prefers-reduced-motion: reduce).
 *
 * The hook reads `window.__PASTURE_FREEZE_IDLE` at init; when set to `true`
 * (e.g. by the screenshot capture script), the loop is never started.
 */

import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { AnchorSlot, SubRegion } from "@/lib/pasture/zones";
import type { NameReviewCard } from "@/lib/review/session";
import {
  createSpriteState,
  tickSprite,
  type SpriteState,
} from "@/lib/pasture/behavior";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Placement = {
  card: NameReviewCard;
  subRegion: SubRegion;
  anchor: AnchorSlot;
};

/** Per-entry in the sprite map — combines DOM ref, band, and tick state. */
type SpriteEntry = {
  el: HTMLElement;
  state: SpriteState;
};

// ---------------------------------------------------------------------------
// Band derivation helpers
// ---------------------------------------------------------------------------

/**
 * Derives the wander band for a placement's sub-region: min/max of the
 * x and y coordinates across all anchor slots in that sub-region.
 * Falls back to a ±3% band around the anchor if the region has < 2 slots.
 */
function deriveBand(
  subRegion: SubRegion,
  anchor: AnchorSlot,
): { bandX0: number; bandX1: number; bandY0: number; bandY1: number } {
  const slots = subRegion.anchorSlots;
  if (slots.length < 2) {
    return {
      bandX0: Math.max(0, anchor.x - 0.03),
      bandX1: Math.min(1, anchor.x + 0.03),
      bandY0: Math.max(0, anchor.y - 0.015),
      bandY1: Math.min(1, anchor.y + 0.015),
    };
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const s of slots) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  // Add a small margin so even a narrow band allows visible drift.
  const xMargin = Math.max(0.02, (maxX - minX) * 0.05);
  const yMargin = Math.max(0.008, (maxY - minY) * 0.5);
  return {
    bandX0: Math.max(0, minX - xMargin),
    bandX1: Math.min(1, maxX + xMargin),
    bandY0: Math.max(0, minY - yMargin),
    bandY1: Math.min(1, maxY + yMargin),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __PASTURE_FREEZE_IDLE?: boolean;
  }
}

export function useIdleBehaviour(
  zoneRef: RefObject<HTMLElement | null>,
  placements: Placement[],
): void {
  // Store sprite map in a ref so the rAF loop always reads the latest without
  // triggering re-renders.
  const spriteMapRef = useRef<Map<number, SpriteEntry>>(new Map());
  const rafRef = useRef<number | null>(null);
  const isVisibleRef = useRef(true);
  const docVisibleRef = useRef(true);
  const frozenRef = useRef(false);

  useLayoutEffect(() => {
    const container = zoneRef.current;
    if (!container) return;

    // Freeze flag — set by screenshot script before page JS runs.
    if (typeof window !== "undefined" && window.__PASTURE_FREEZE_IDLE) {
      frozenRef.current = true;
      return;
    }

    // prefers-reduced-motion check.
    const motionQuery =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

    if (motionQuery?.matches) {
      frozenRef.current = true;
      return;
    }

    // Build sprite map — query [data-sprite-id] elements inside container.
    const map = spriteMapRef.current;
    map.clear();

    const now = performance.now();

    for (const { card, subRegion, anchor } of placements) {
      const el = container.querySelector<HTMLElement>(
        `[data-sprite-id="${card.id}"]`,
      );
      if (!el) continue;

      const band = deriveBand(subRegion, anchor);
      const state = createSpriteState(
        anchor.x,
        anchor.y,
        band.bandX0,
        band.bandX1,
        band.bandY0,
        band.bandY1,
        now,
      );
      map.set(card.id, { el, state });
    }

    // IntersectionObserver — pause loop when zone is off-screen.
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(container);

    // visibilitychange — pause when tab is hidden.
    function onVisibility() {
      docVisibleRef.current = document.visibilityState === "visible";
    }
    document.addEventListener("visibilitychange", onVisibility);
    docVisibleRef.current = document.visibilityState === "visible";

    // prefers-reduced-motion live change listener.
    function onMotionChange(e: MediaQueryListEvent) {
      frozenRef.current = e.matches;
      if (e.matches && rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        // Reset all transforms so sprites settle cleanly.
        for (const [, entry] of spriteMapRef.current) {
          entry.el.style.transform = "";
        }
      } else if (!e.matches && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(loop);
      }
    }
    motionQuery?.addEventListener("change", onMotionChange);

    // rAF loop.
    function loop() {
      rafRef.current = requestAnimationFrame(loop);

      if (!isVisibleRef.current || !docVisibleRef.current || frozenRef.current) {
        return;
      }

      const t = performance.now();
      for (const [, entry] of spriteMapRef.current) {
        const result = tickSprite(entry.state, t);
        if (!result.changed) continue;

        // Translate within zone: convert fractional offset from anchor to
        // percentage-point offset (multiply by 100). We push just the delta
        // from anchor so the CSS left/top on spriteAnchor remains authoritative.
        const anchorX = entry.state.bandX0 + (entry.state.bandX1 - entry.state.bandX0) / 2;
        const anchorY = entry.state.bandY0 + (entry.state.bandY1 - entry.state.bandY0) / 2;

        // dx/dy in percentage points relative to the zone container's dimensions.
        // We compute the delta from the "centre of band" rather than the static
        // anchor so that existing left/top CSS stays correct at rest.
        // The wander wrapper sits INSIDE the spriteAnchor div, so the transform
        // here is purely extra offset on top of the anchor position.
        const pctX = (result.x - anchorX) * 100;
        const pctY = (result.y - anchorY) * 100;

        entry.el.style.transform =
          `translate(${pctX}%, ${pctY}%) translateY(${result.jumpOffsetPx}px) ` +
          `scale(${result.squashX}, ${result.squashY})`;
      }
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener("change", onMotionChange);
      // Clear transforms on unmount so there's no residual state.
      for (const [, entry] of spriteMapRef.current) {
        entry.el.style.transform = "";
      }
      map.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneRef, placements]);
}
