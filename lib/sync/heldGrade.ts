import type { ReviewableCard } from "@/lib/review/session";
import { KEY_HELD_GRADE } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

/**
 * State for a grade that is still inside its undo window (#2052).
 *
 * A held card is deliberately kept OUT of the shared pending-grade queue
 * (`poke-memory:pending-grade-queue:v1` and its IndexedDB mirror). That queue
 * is read by code that knows nothing about the hold: `pushWithFallback`
 * (online-reconnect and Retry), and the service worker's Background Sync
 * handler. Anything in it can be pushed at any moment, which would resurrect a
 * grade the user then undoes. So:
 *
 *   - the durability copy lives under its own localStorage-only key
 *     (`KEY_HELD_GRADE`): no IDB mirror, so the service worker never sees it;
 *   - an in-memory key set (`isCardPushHeld`) lets `pushWithFallback`'s
 *     session-fallback branch skip the held card, which is already in the
 *     saved session because `saveSession` runs before the grade is committed;
 *   - on the next mount the persisted held card is seeded into the queue as a
 *     COMMITTED grade (a reload ends the undo window).
 */

/** Locale-aware card identity used by the push queue and the hold (#1259). */
export function cardPushKey(card: Pick<ReviewableCard, "id" | "locale">): string {
  return `${card.id}:${card.locale ?? "en"}`;
}

const heldKeys = new Set<string>();

/** True while the card with this `cardPushKey` is inside its undo window. */
export function isCardPushHeld(key: string): boolean {
  return heldKeys.has(key);
}

export function markCardPushHeld(key: string): void {
  heldKeys.add(key);
}

/** Releases an in-memory hold (commit or discard). Idempotent. */
export function releaseCardPushHold(key: string): void {
  heldKeys.delete(key);
}

function parseHeldCard(raw: string): ReviewableCard | null {
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null) return null;
  const c = parsed as Record<string, unknown>;
  // Same minimum shape the pending queue validates before a push.
  if (
    "id" in c &&
    typeof c.cardType === "string" &&
    typeof c.subjectKey === "string" &&
    typeof c.state === "object" &&
    c.state !== null
  ) {
    return parsed as ReviewableCard;
  }
  return null;
}

/** Persists the held card (localStorage only, never the IDB mirror). */
export function saveHeldCard(card: ReviewableCard): void {
  writeLocalStorage(KEY_HELD_GRADE, card);
}

export function loadHeldCard(): ReviewableCard | null {
  return readLocalStorage(KEY_HELD_GRADE, parseHeldCard, null);
}

export function clearHeldCard(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY_HELD_GRADE);
  } catch {
    // Best effort.
  }
}
