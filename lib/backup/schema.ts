import type { ReviewableCard, DailyLimits } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";

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
function isMinimalCardShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "number") return false;
  if (typeof v.state !== "object" || v.state === null) return false;
  if (typeof (v.state as Record<string, unknown>).dueDate !== "string") return false;
  if (
    v.cardType !== undefined &&
    v.cardType !== "name" &&
    v.cardType !== "evolution" &&
    v.cardType !== "reverse" &&
    v.cardType !== "cry"
  ) {
    return false;
  }
  if (v.cardType === "evolution") {
    // New edge shape: requires postEvoId (the discriminator that distinguishes
    // edge cards from legacy per-pre-evo cards). Other edge fields are
    // refreshed from seed on hydrate, so they're not validated here.
    if (typeof v.postEvoId === "number") return true;
    // Legacy shape: evolvesInto: { name, spriteUrl }[] OR evolvesIntoNames.
    // The import pipeline drops these; we accept them here so the file as a
    // whole still validates.
    if (
      Array.isArray(v.evolvesInto) &&
      v.evolvesInto.every(
        (e: unknown) =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>).name === "string" &&
          typeof (e as Record<string, unknown>).spriteUrl === "string",
      )
    ) {
      return true;
    }
    if (
      Array.isArray(v.evolvesIntoNames) &&
      v.evolvesIntoNames.every((n: unknown) => typeof n === "string")
    ) {
      return true;
    }
    return false;
  }
  return true;
}

function isPerTypeLimitsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number"
  );
}

function isLimitsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // `reverse` is optional — existing exports don't have it; loadSession in lib/review/persistence.ts backfills.
  return isPerTypeLimitsShaped(v.name) && isPerTypeLimitsShaped(v.evolution);
}

function isSettingsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // reverseCardsEnabled and maxNew/ReviewsReversePerDay are optional —
  // loadSettings backfills them on import so existing exports remain valid.
  return (
    typeof v.masteryRepetitions === "number" &&
    typeof v.maxNewPerDay === "number" &&
    typeof v.maxReviewsPerDay === "number" &&
    typeof v.maxNewEvolutionPerDay === "number" &&
    typeof v.maxReviewsEvolutionPerDay === "number"
  );
}

export function isBackupFile(value: unknown): value is BackupFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== BACKUP_VERSION) return false;
  if (typeof v.exportedAt !== "string") return false;
  if (!Array.isArray(v.cards)) return false;
  if (!v.cards.every(isMinimalCardShaped)) return false;
  if (!isLimitsShaped(v.limits)) return false;
  if (!isSettingsShaped(v.settings)) return false;
  return true;
}
