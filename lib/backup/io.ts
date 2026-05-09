import { loadSession, saveSession } from "@/lib/review/persistence";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { SEED_POKEMON, SEED_EVOLUTION_CARDS } from "@/lib/pokemon/seed";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import type { ReviewableCard } from "@/lib/review/session";
import { BACKUP_VERSION, isBackupFile } from "./schema";

export function exportProgress(): void {
  if (typeof window === "undefined") return;

  const session = loadSession() ?? { cards: [], limits: DEFAULT_LIMITS };
  const settings = loadSettings();

  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    cards: session.cards,
    limits: session.limits,
    settings,
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);

  const a = document.createElement("a");
  a.href = url;
  a.download = `poke-memory-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importProgress(
  file: File,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: unknown;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file isn't a valid poke-memory backup." };
  }

  // Check version before full shape validation to surface a user-friendly error
  // when the file was produced by a newer version of the app.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).version === "number" &&
    (parsed as Record<string, unknown>).version !== BACKUP_VERSION
  ) {
    const v = (parsed as Record<string, unknown>).version;
    return { ok: false, error: `Backup version ${v} isn't supported.` };
  }

  if (!isBackupFile(parsed)) {
    return { ok: false, error: "This file isn't a valid poke-memory backup." };
  }

  const validIds = new Set<number>([
    ...SEED_POKEMON.map((p) => p.id),
    ...SEED_EVOLUTION_CARDS.map((e) => e.id),
  ]);

  for (const card of parsed.cards) {
    if (!validIds.has(card.id)) {
      return { ok: false, error: "This file isn't a valid poke-memory backup." };
    }
  }

  // Null out stepStartedAt to prevent stale countdown timers after import.
  const sanitisedCards = parsed.cards.map(
    (card) =>
      ({
        ...card,
        state: { ...card.state, stepStartedAt: null },
      }) as ReviewableCard,
  );

  saveSession({ cards: sanitisedCards, limits: parsed.limits });
  saveSettings(parsed.settings);

  return { ok: true };
}
