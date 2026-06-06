import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import type { SeedPokemon } from "@/lib/pokemon/seed";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-constants";
import { getSeedIfLoaded } from "@/lib/pokemon/seed-async";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import type { ReviewableCard, DailyLimits } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";
import { BACKUP_VERSION, isBackupFile } from "./schema";
import { isoDate } from "@/lib/utils/format-date";

// Lazy valid-id set - memoised only once the seed has loaded.
// Returns a new (empty) Set on each call until the seed is available so the
// caller falls through to the "not found" error path naturally.
let _validIdsCache: ReadonlySet<number> | null = null;

function getValidIds(): ReadonlySet<number> {
  if (_validIdsCache !== null) return _validIdsCache;
  const seed = getSeedIfLoaded();
  if (!seed) return new Set<number>();
  _validIdsCache = new Set<number>([
    ...seed.seedPokemon.map((p: SeedPokemon) => p.id),
    ...seed.seedEvolutionCards.map((e: { id: number }) => e.id),
    ...seed.seedPokemon.map((p: SeedPokemon) => REVERSE_ID_OFFSET + p.id),
  ]);
  return _validIdsCache;
}

export type ValidatedBackup = {
  cards: ReviewableCard[];
  limits: DailyLimits;
  settings: UserSettings;
};

export async function exportProgress(): Promise<void> {
  if (typeof window === "undefined") return;

  const session = (await loadSession()) ?? { cards: [], limits: DEFAULT_LIMITS };
  const settings = loadSettings();

  const now = new Date();
  const backup = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    cards: session.cards,
    limits: session.limits,
    settings,
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = isoDate(now);

  const a = document.createElement("a");
  a.href = url;
  a.download = `poke-memory-backup-${date}.json`;
  a.click();
  // Defer revocation so the download has time to start before the URL is freed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function validateBackup(
  file: File,
): Promise<{ ok: true; data: ValidatedBackup } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't a valid poke-memory backup." };
  }

  // Check version before full shape validation to surface a user-friendly error
  // when the file was produced by a newer version of the app.
  if (typeof parsed === "object" && parsed !== null) {
    const v = (parsed as Record<string, unknown>).version;
    if (v !== undefined && v !== BACKUP_VERSION) {
      return { ok: false, error: `Backup version ${v} isn't supported.` };
    }
  }

  if (!isBackupFile(parsed)) {
    return { ok: false, error: "This file isn't a valid poke-memory backup." };
  }

  const validIds = getValidIds();
  for (const card of parsed.cards) {
    if (validIds.size > 0 && !validIds.has(card.id)) {
      return { ok: false, error: "This file isn't a valid poke-memory backup." };
    }
  }

  // Null out stepStartedAt to prevent stale countdown timers after import.
  // ReviewSession's mount-time stamp loop will re-stamp any in-learning card
  // with null stepStartedAt as Date.now(), giving it a fresh step window - 
  // this is intentional: imported cards start a clean step rather than
  // inheriting a possibly-hours-old anchor from the backup.
  // Static seed fields (name, spriteUrl, evolvesInto) are intentionally kept
  // from the backup: every consumer calls hydrateSession after loadSession,
  // which refreshes them from the current seed. Calling hydrateSession here
  // would also add all seed cards missing from the backup - not the right
  // behaviour for a restore operation.
  const cards = parsed.cards.map(
    (card) =>
      ({
        ...card,
        state: { ...card.state, stepStartedAt: null },
      }) as ReviewableCard,
  );

  return { ok: true, data: { cards, limits: parsed.limits, settings: parsed.settings } };
}

export async function applyBackup(data: ValidatedBackup): Promise<void> {
  await saveSession({ cards: data.cards, limits: data.limits });
  saveSettings(data.settings);
}
