import type { ReviewableCard, DailyLimits } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";
import { isBaseCardShaped, isNonNullObject } from "@/lib/review/card-shape";

// Increment when the shape of BackupFile changes incompatibly.
export const BACKUP_VERSION = 1 as const;

export type BackupFile = {
  version: 1;
  exportedAt: string;
  cards: ReviewableCard[];
  limits: DailyLimits;
  settings: UserSettings;
};

// Intentionally less strict than isReviewCardShaped in persistence.ts:
// - name and spriteUrl are omitted — hydrateSession refreshes them from seed on every load.
// - Only dueDate is validated in state — other ReviewState fields get migration defaults.
// - Evolution cards: either the new edge shape (postEvoId-keyed) or the
//   legacy per-pre-evo shape are accepted; the import pipeline strips legacy
//   evolution cards before hydration (#262 — there is no 1:N mapping from a
//   legacy card to the new edge cards).
//
// Uses isBaseCardShaped from lib/review/card-shape.ts for the shared core;
// no extra strictness is layered on top here because hydrateSession refreshes
// the fields that isReviewCardShaped additionally validates.
function isMinimalCardShaped(value: unknown): value is ReviewableCard {
  return isBaseCardShaped(value);
}

function isPerTypeLimitsShaped(value: unknown): boolean {
  if (!isNonNullObject(value)) return false;
  return (
    typeof value.maxNewPerDay === "number" &&
    typeof value.maxReviewsPerDay === "number"
  );
}

function isLimitsShaped(value: unknown): boolean {
  if (!isNonNullObject(value)) return false;
  // `reverse` is optional — existing exports don't have it; loadSession in lib/review/persistence.ts backfills.
  return isPerTypeLimitsShaped(value.name) && isPerTypeLimitsShaped(value.evolution);
}

function isSettingsShaped(value: unknown): boolean {
  if (!isNonNullObject(value)) return false;
  // reverseCardsEnabled and maxNew/ReviewsReversePerDay are optional —
  // loadSettings backfills them on import so existing exports remain valid.
  return (
    typeof value.masteryRepetitions === "number" &&
    typeof value.maxNewPerDay === "number" &&
    typeof value.maxReviewsPerDay === "number" &&
    typeof value.maxNewEvolutionPerDay === "number" &&
    typeof value.maxReviewsEvolutionPerDay === "number"
  );
}

export function isBackupFile(value: unknown): value is BackupFile {
  if (!isNonNullObject(value)) return false;
  if (value.version !== BACKUP_VERSION) return false;
  if (typeof value.exportedAt !== "string") return false;
  if (!Array.isArray(value.cards)) return false;
  if (!value.cards.every(isMinimalCardShaped)) return false;
  if (!isLimitsShaped(value.limits)) return false;
  if (!isSettingsShaped(value.settings)) return false;
  return true;
}
