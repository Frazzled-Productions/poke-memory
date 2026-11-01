import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidatedBackup } from "@/lib/backup/io";
import { planSignedInRestore, pullSession, pushSession } from "@/lib/sync/cloud";
import { pullLastResetAt } from "@/lib/sync/settings";
import {
  loadPendingQueue,
  markPushSucceeded,
  savePendingQueue,
} from "@/lib/sync/persistence";
import { cardPushKey } from "@/lib/sync/heldGrade";
import { loadSession, migrateReviewCard, saveSession } from "@/lib/review/persistence";
import type { ReviewableCard } from "@/lib/review/session";

export type SignedInRestoreResult =
  | { ok: true }
  | { ok: false; reason: "pull-failed" | "save-failed" };

/**
 * Backup files accept older card shapes that only `loadSession` used to bring up
 * to date. Those shapes must not reach a push, so migrate here and drop anything
 * that still has no cloud identity (retired legacy evolution cards).
 */
function currentShape(cards: readonly ReviewableCard[]): ReviewableCard[] {
  const copies = structuredClone(cards) as ReviewableCard[];
  copies.forEach(migrateReviewCard);
  return copies.filter((c) => typeof c.subjectKey === "string");
}

/**
 * Restores a backup for a signed-in user. Cards only ever move forward: the
 * cloud is never lowered, so this device and the cloud agree afterwards instead
 * of diverging until the regression trigger refuses the next grade.
 *
 * Settings and daily limits are left alone. `user_settings_reject_regression`
 * (migration 038) refuses a patch that lowers a guarded field, and refuses the
 * whole patch, so older settings would stop this device's settings syncing:
 * `AutoSyncOnChange` keeps its snapshot on a refusal and resends the same keys.
 *
 * Pulls before anything is written, as docs/sync.md requires of anything that
 * merges and pushes: pull, load local, merge, save, push. Local is loaded after the
 * pull, as in `pullAndMerge`, so a grade saved during the pull is merged too. If
 * either read fails nothing has changed: without the last reset, cards the database
 * refuses could not be left out. If the push fails, the cards go in the pending
 * queue, which `usePerGradeSync` drains when Practice next opens, with its usual
 * retry and its eviction of refused cards.
 */
export async function restoreBackupSignedIn(
  client: SupabaseClient,
  userId: string,
  data: ValidatedBackup,
): Promise<SignedInRestoreResult> {
  const cloudRows = await pullSession(client, userId);
  if (cloudRows === null) return { ok: false, reason: "pull-failed" };

  const reset = await pullLastResetAt(client, userId);
  if (reset === null) return { ok: false, reason: "pull-failed" };

  const local = await loadSession();
  const { cards, toPush } = planSignedInRestore(
    currentShape(data.cards),
    local?.cards ?? [],
    cloudRows,
    reset.lastResetAt,
  );

  const saved = await saveSession({ cards, limits: local?.limits ?? data.limits });
  if (!saved.ok) return { ok: false, reason: "save-failed" };

  if (toPush.length > 0) {
    if (await pushSession(client, userId, toPush)) {
      markPushSucceeded();
    } else {
      const restored = new Set(toPush.map(cardPushKey));
      savePendingQueue([
        ...loadPendingQueue().filter((c) => !restored.has(cardPushKey(c))),
        ...toPush,
      ]);
    }
  }
  return { ok: true };
}
