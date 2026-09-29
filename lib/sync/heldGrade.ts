import type { ReviewableCard } from "@/lib/review/session";
import { KEY_HELD_GRADE_PREFIX, KEY_TAB_ID } from "@/lib/storage/keys";

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
 *   - the durability copy lives under its own localStorage-only key, one per
 *     TAB (`KEY_HELD_GRADE_PREFIX + tabId`): no IDB mirror, so the service
 *     worker never sees it, and two tabs holding at once never overwrite each
 *     other;
 *   - the record carries `{ userId, tabId, heldAt }`. A later mount seeds a
 *     leftover only for the SAME user, and only when it is safe: it was left by
 *     this same tab (a reload ends the undo window) or it is older than the
 *     longest a live hold can last (its owner tab is gone). A copy that a live
 *     other tab still owns is never touched;
 *   - `heldCardPushKeys()` (in-memory holds plus every live persisted record,
 *     any tab) lets `pushWithFallback`'s session-fallback branch skip held
 *     cards, which are already in the saved session because `saveSession` runs
 *     before the grade is committed.
 *
 * Not persisted: the held grade-log entry. If the page dies mid-hold it stays
 * local-only until the grade-log re-push leg in `pullAndMerge` sends it once it
 * is older than `HELD_COPY_STALE_MS` (`lib/sync/gradeLogRepush.ts`, #2117).
 */

/**
 * How long the tab may stay hidden before an undoable grade is committed to
 * the cloud and its undo expires (#2052). Short enough that a backgrounded
 * mobile tab still syncs, long enough that a quick app switch keeps undo.
 */
export const UNDO_HOLD_HIDDEN_GRACE_MS = 30_000;

/**
 * Total cap on how long a grade can be held, counted from the moment it is
 * graded, whether the tab is visible or not and whatever the user does in the
 * meantime (#2052). It is NOT an idle timer: it does not reset on activity.
 * After this the grade is committed and Undo silently expires, so an
 * abandoned-but-open session cannot hold a grade off the cloud indefinitely.
 */
export const UNDO_HOLD_MAX_MS = 300_000;

/**
 * A persisted held copy older than this cannot belong to a live hold: the cap
 * would already have committed it (the hidden grace is added as slack for timer
 * throttling in background tabs). Its owner tab is gone.
 */
export const HELD_COPY_STALE_MS = UNDO_HOLD_MAX_MS + UNDO_HOLD_HIDDEN_GRACE_MS;

/** Locale-aware card identity used by the push queue and the hold (#1259). */
export function cardPushKey(card: Pick<ReviewableCard, "id" | "locale">): string {
  return `${card.id}:${card.locale ?? "en"}`;
}

type HeldRecord = {
  userId: string;
  tabId: string;
  /** Epoch ms the grade was held. */
  heldAt: number;
  card: ReviewableCard;
};

/**
 * Stable id for this tab: a sessionStorage token, so a reload of the same tab
 * keeps it and another tab gets its own. (A browser "duplicate tab" copies
 * sessionStorage, so the copy shares the id: the residual edge is that a
 * duplicate could seed the original's live copy. It needs a duplicate made
 * while a grade is held, and only ever commits a grade early.)
 */
export function getTabId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(KEY_TAB_ID);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(KEY_TAB_ID, id);
    return id;
  } catch {
    // sessionStorage unavailable: a per-page-life id (a reload then counts as
    // another tab and its copy is seeded once stale).
    return `volatile-${Math.random().toString(36).slice(2)}`;
  }
}

const heldKeys = new Set<string>();

export function markCardPushHeld(key: string): void {
  heldKeys.add(key);
}

/** Releases an in-memory hold (commit or discard). Idempotent. */
export function releaseCardPushHold(key: string): void {
  heldKeys.delete(key);
}

function parseRecord(raw: string): HeldRecord | null {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const c = p.card as Record<string, unknown> | null | undefined;
    if (
      typeof p.userId === "string" &&
      typeof p.tabId === "string" &&
      typeof p.heldAt === "number" &&
      typeof c === "object" &&
      c !== null &&
      "id" in c &&
      typeof c.cardType === "string" &&
      typeof c.subjectKey === "string" &&
      typeof c.state === "object" &&
      c.state !== null
    ) {
      return p as unknown as HeldRecord;
    }
  } catch {
    // fall through
  }
  return null;
}

/** Every persisted held record, with its storage key. Malformed entries are skipped. */
function scanHeldRecords(): { storageKey: string; record: HeldRecord | null }[] {
  if (typeof window === "undefined") return [];
  const out: { storageKey: string; record: HeldRecord | null }[] = [];
  try {
    const ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k === null || !k.startsWith(KEY_HELD_GRADE_PREFIX)) continue;
      const raw = ls.getItem(k);
      out.push({ storageKey: k, record: raw === null ? null : parseRecord(raw) });
    }
  } catch {
    // Best effort.
  }
  return out;
}

/** Persists this tab's held card (localStorage only, never the IDB mirror). */
export function saveHeldCard(card: ReviewableCard, userId: string, tabId: string): void {
  if (typeof window === "undefined") return;
  const record: HeldRecord = { userId, tabId, heldAt: Date.now(), card };
  try {
    window.localStorage.setItem(KEY_HELD_GRADE_PREFIX + tabId, JSON.stringify(record));
  } catch {
    // Quota or similar: best effort (the in-memory hold still protects this tab).
  }
}

/** Test/inspection helper: this tab's persisted held card, or null. */
export function loadHeldCard(tabId: string): ReviewableCard | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY_HELD_GRADE_PREFIX + tabId);
    return raw === null ? null : (parseRecord(raw)?.card ?? null);
  } catch {
    return null;
  }
}

/** Drops this tab's own persisted held copy. */
export function clearHeldCard(tabId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY_HELD_GRADE_PREFIX + tabId);
  } catch {
    // Best effort.
  }
}

/**
 * Returns (and removes) the leftover held copies this mount may treat as
 * committed grades: same user AND (left by this same tab OR stale). `ownHoldLive`
 * excludes this tab's own record while it still has a live hold. Copies of
 * another user, and copies a live other tab still owns, are left untouched.
 * Malformed entries are discarded.
 */
export function takeLeftoverHeldCards(
  userId: string,
  tabId: string,
  opts: { ownHoldLive?: boolean; now?: number } = {},
): ReviewableCard[] {
  const now = opts.now ?? Date.now();
  const taken: ReviewableCard[] = [];
  for (const { storageKey, record } of scanHeldRecords()) {
    if (record === null) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // Best effort.
      }
      continue;
    }
    if (record.userId !== userId) continue;
    // This tab's own record belongs to its live hold when there is one.
    if (opts.ownHoldLive && record.tabId === tabId) continue;
    const sameTab = record.tabId === tabId;
    const stale = now - record.heldAt > HELD_COPY_STALE_MS;
    if (!sameTab && !stale) continue;
    taken.push(record.card);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Best effort.
    }
  }
  return taken;
}

/**
 * Card keys (`cardPushKey`) currently inside an undo window anywhere: this
 * tab's in-memory holds plus every non-stale persisted record of any tab.
 * `pushWithFallback`'s session fallback skips these.
 */
export function heldCardPushKeys(now: number = Date.now()): Set<string> {
  const keys = new Set(heldKeys);
  for (const { record } of scanHeldRecords()) {
    if (record !== null && now - record.heldAt <= HELD_COPY_STALE_MS) {
      keys.add(cardPushKey(record.card));
    }
  }
  return keys;
}

/** True while the card with this `cardPushKey` is inside an undo window (any tab). */
export function isCardPushHeld(key: string): boolean {
  return heldCardPushKeys().has(key);
}
