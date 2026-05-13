/**
 * Assigns anchor positions to mastered cards within a habitat zone (#350).
 *
 * Cards are sorted by `state.firstSeen` ASC (oldest mastery first) then by
 * card `id` as a deterministic tie-break. Sub-regions are filled sequentially
 * in definition order; overflow wraps modularly so two Pokémon may visually
 * overlap rather than crashing.
 */

import type { ReviewableCard } from "@/lib/review/session";
import type { HabitatZone, SubRegion, AnchorSlot } from "./zones";

export type CardAssignment = {
  card: ReviewableCard;
  subRegion: SubRegion;
  anchor: AnchorSlot;
};

/**
 * Assigns each card in `cards` to a sub-region and anchor slot within `zone`.
 *
 * Sort order: `state.firstSeen` ASC (null sorts last), then `card.id` ASC.
 * Fill order: sub-regions in definition order, slots within each sub-region
 * in definition order. Overflow wraps using `slotIndex % totalSlots`.
 *
 * Returns an array of the same length as `cards` (one assignment per card).
 * Returns an empty array when `cards` is empty or `zone` has no sub-regions.
 */
export function assignAnchors(
  cards: ReviewableCard[],
  zone: HabitatZone,
): CardAssignment[] {
  if (cards.length === 0) return [];

  // Flatten all slots with their sub-region references so we can index linearly.
  const allSlots: Array<{ subRegion: SubRegion; anchor: AnchorSlot }> = [];
  for (const subRegion of zone.subRegions) {
    for (const anchor of subRegion.anchorSlots) {
      allSlots.push({ subRegion, anchor });
    }
  }

  if (allSlots.length === 0) return [];

  const totalSlots = allSlots.length;

  // Sort: firstSeen ASC (null last), then id ASC for determinism.
  const sorted = [...cards].sort((a, b) => {
    const fa = a.state.firstSeen;
    const fb = b.state.firstSeen;
    if (fa === null && fb === null) return a.id - b.id;
    if (fa === null) return 1;
    if (fb === null) return -1;
    if (fa < fb) return -1;
    if (fa > fb) return 1;
    return a.id - b.id;
  });

  return sorted.map((card, index) => {
    const slot = allSlots[index % totalSlots];
    return {
      card,
      subRegion: slot.subRegion,
      anchor: slot.anchor,
    };
  });
}
