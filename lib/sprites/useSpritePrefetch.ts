"use client";

import { useCallback } from "react";
import { decodeSpriteUrls } from "@/lib/sprites/decode";

/**
 * Generic sprite prefetch hook.
 *
 * Exposes a `decodeAhead` callback that callers invoke just before a state
 * transition (e.g. flipping a card, grading, navigating to the next item) to
 * bridge the fetch→GPU-decode gap. Internally delegates to `decodeSpriteUrls`
 * which races each `HTMLImageElement.decode()` call against a 500 ms
 * safety-valve timeout so the UI is never stuck.
 *
 * Usage pattern:
 * ```ts
 * const { decodeAhead } = useSpritePrefetch();
 * // ... before a state swap:
 * await decodeAhead([nextSpriteUrl]);
 * setCard(nextCard);
 * ```
 *
 * This hook does not mount any DOM nodes itself; pair it with `SpritePreloader`
 * to also warm the browser's network cache ahead of the decode call.
 */
export function useSpritePrefetch() {
  const decodeAhead = useCallback(
    (urls: readonly string[]): Promise<void> => decodeSpriteUrls(urls),
    [],
  );

  return { decodeAhead };
}
