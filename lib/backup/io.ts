import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import type { ReviewableCard, DailyLimits } from "@/lib/review/session";
import type { UserSettings } from "@/lib/settings/persistence";
import { BACKUP_VERSION, isBackupFile } from "./schema";

// Built once at module load — SEED_POKEMON and SEED_EVOLUTION_CARDS are constants.
const VALID_IDS = new Set<number>([
  ...SEED_POKEMON.map((p) => p.id),
  ...SEED_EVOLUTION_CARDS.map((e) => e.id),
]);

export type ValidatedBackup = {
  cards: ReviewableCard[];
  limits: DailyLimits;
  settings: UserSettings;
};

export function exportProgress(): void {
  if (typeof window === "undefined") return;

  const session = loadSession() ?? { cards: [], limits: DEFAULT_LIMITS };
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
  const date = now.toISOString().slice(0, 10);

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

  for (const card of parsed.cards) {
    if (!VALID_IDS.has(card.id)) {
      return { ok: false, error: "This file isn't a valid poke-memory backup." };
    }
  }

  // Null out stepStartedAt to prevent stale countdown timers after import.
  // Static seed fields (name, spriteUrl, evolvesInto) are intentionally kept
  // from the backup: every consumer calls hydrateSession after loadSession,
  // which refreshes them from the current seed. Calling hydrateSession here
  // would also add all seed cards missing from the backup — not the right
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

export function applyBackup(data: ValidatedBackup): void {
  saveSession({ cards: data.cards, limits: data.limits });
  saveSettings(data.settings);
}
