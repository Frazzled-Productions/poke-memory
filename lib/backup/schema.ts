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

// Shape checks mirror lib/review/persistence.ts — keep in sync if those shapes evolve.
function isMinimalCardShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "number") return false;
  if (typeof v.state !== "object" || v.state === null) return false;
  if (typeof (v.state as Record<string, unknown>).dueDate !== "string") return false;
  if (
    v.cardType !== undefined &&
    v.cardType !== "name" &&
    v.cardType !== "evolution"
  ) {
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
  return isPerTypeLimitsShaped(v.name) && isPerTypeLimitsShaped(v.evolution);
}

function isSettingsShaped(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
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
