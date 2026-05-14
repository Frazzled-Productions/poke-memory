import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard, BuildSessionOpts } from "@/lib/review/session";
import { buildSession } from "@/lib/review/session";
import type { SeedPokemon, EvolutionCard } from "@/lib/pokemon/seed";
import { appTypeToDbType, dbTypeToAppType } from "@/lib/cards/subjectKey";

/** Options forwarded to `buildSession` when rebuilding a card set from seed. */
export type SeedOpts = BuildSessionOpts;

// Sync is best-effort: all errors are swallowed so a network hiccup never
// breaks the local-first review flow.

/**
 * Returns true when a card's SM-2 state is safe to write to the cloud.
 * A card is unsafe when firstSeen is set but lastReview is null — this means
 * the card entered learning steps but has not yet graduated. Writing this state
 * would produce a row with first_seen != null and last_review = null, violating
 * the invariant that every seen card has a review date.
 */
export function isSyncSafe(card: ReviewableCard): boolean {
  return !(card.state.firstSeen !== null && card.state.lastReview === null);
}

/**
 * Cloud row shape after migration 012.
 *
 * Primary identity: (card_type, subject_key).
 *   card_type   — DB discriminator (e.g. "name", "evolution-edge"). Note: the
 *                 app internally uses "evolution" / "reverse-evolution"; these
 *                 are mapped by appTypeToDbType / dbTypeToAppType.
 *   subject_key — type-specific opaque key: species ID string for species cards,
 *                 "fromId>>>toId" for edge cards.
 *
 * The legacy `pokemon_id` integer column was dropped by migration 012. Push
 * paths upsert via `(user_id, card_type, subject_key)` and never write
 * `pokemon_id` — it does not exist on the table.
 */
export type CloudRow = {
  /** DB card_type discriminator. Use appTypeToDbType / dbTypeToAppType to convert to/from app types. */
  card_type: string;
  /** Type-specific identity key. Null for unmigrated edge rows (skipped on pull). */
  subject_key: string | null;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  fsrs_state: "new" | "learning" | "review" | "relearning";
  due_date: string;
  last_review: string | null;
  first_seen: string | null;
  /**
   * Learning-filter snooze stamp (#333). Nullable. ISO YYYY-MM-DD.
   * Cleared on un-hide once dueDate has been shifted forward.
   */
  hidden_since: string | null;
  /** Pasture feature (#350). True once the user has tapped this card on the Pasture page (clears the new-arrival sparkle). One-way: migration 017 trigger rejects true→false. */
  seen_in_pasture: boolean;
  /** Present on pull responses. Absent on locally-constructed push rows (added in the upsert batch). */
  updated_at?: string;
};

/**
 * Returns true when the user already has at least one card_review row in the
 * cloud. Used by the conflict-picker to decide whether to show a merge prompt.
 */
export async function hasCloudData(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { count, error } = await client
      .from("card_reviews")
      .select("card_type", { count: "exact", head: true })
      .eq("user_id", userId)
      .limit(1);
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

function toCloudRow(card: ReviewableCard): CloudRow {
  return {
    card_type: appTypeToDbType(card.cardType),
    subject_key: card.subjectKey,
    stability: card.state.stability,
    difficulty: card.state.difficulty,
    elapsed_days: card.state.elapsedDays,
    scheduled_days: card.state.scheduledDays,
    reps: card.state.reps,
    lapses: card.state.lapses,
    fsrs_state: card.state.fsrsState,
    due_date: card.state.dueDate,
    last_review: card.state.lastReview,
    first_seen: card.state.firstSeen,
    hidden_since: card.state.hiddenSince,
    seen_in_pasture: card.state.seenInPasture,
  };
}

/**
 * Pushes the full local session to the cloud via batched upserts.
 * Returns true if all batches succeeded, false if any batch failed.
 * learningStep and stepStartedAt are in-memory only and are not persisted.
 * Cards that violate the firstSeen/lastReview invariant are silently skipped
 * rather than written — in-step cards (firstSeen set, lastReview null) should
 * not be persisted to the cloud until they graduate.
 * Note: returns true when every card is filtered out (no batches attempted =
 * no failures). The caller should not interpret true as "something was written".
 */
export async function pushSession(
  client: SupabaseClient,
  userId: string,
  cards: ReviewableCard[],
): Promise<boolean> {
  const safeCards = cards.filter((card) => {
    if (isSyncSafe(card)) return true;
    console.warn(
      `[sync] skipping card ${card.cardType}:${card.subjectKey}: firstSeen set but lastReview null (in-step, not graduated)`
    );
    return false;
  });

  const rows: CloudRow[] = safeCards.map(toCloudRow);

  let allOk = true;
  const BATCH = 200;
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, user_id: userId, updated_at: updatedAt }));
    try {
      const { error } = await client
        .from("card_reviews")
        .upsert(batch, { onConflict: "user_id,card_type,subject_key" });
      if (error) allOk = false;
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

/**
 * Upserts a single card into card_reviews. Best-effort — returns false on any
 * error without throwing. Returns false without a network call when the card
 * violates the firstSeen/lastReview invariant (in-step, not yet graduated).
 */
export async function pushSingleCard(
  client: SupabaseClient,
  userId: string,
  card: ReviewableCard,
): Promise<boolean> {
  if (!isSyncSafe(card)) {
    console.warn(
      `[sync] skipping card ${card.cardType}:${card.subjectKey}: firstSeen set but lastReview null (in-step, not graduated)`
    );
    return false;
  }
  try {
    const { error } = await client.from("card_reviews").upsert(
      {
        user_id: userId,
        card_type: appTypeToDbType(card.cardType),
        subject_key: card.subjectKey,
        stability: card.state.stability,
        difficulty: card.state.difficulty,
        elapsed_days: card.state.elapsedDays,
        scheduled_days: card.state.scheduledDays,
        reps: card.state.reps,
        lapses: card.state.lapses,
        fsrs_state: card.state.fsrsState,
        due_date: card.state.dueDate,
        last_review: card.state.lastReview,
        first_seen: card.state.firstSeen,
        hidden_since: card.state.hiddenSince,
        seen_in_pasture: card.state.seenInPasture,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,card_type,subject_key" },
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Pulls all card_review rows for the user from the cloud.
 * Returns null on error so the caller can fall back to local-only mode.
 * learningStep and stepStartedAt are not stored in the cloud; the caller
 * is responsible for reconstructing in-memory state from the seed.
 *
 * Paginates in PAGE-sized chunks to avoid the Supabase default max_rows cap
 * of 1000, which would silently truncate a full ~1482-card corpus.
 */
export async function pullSession(
  client: SupabaseClient,
  userId: string,
): Promise<CloudRow[] | null> {
  const PAGE = 1000;
  const allRows: CloudRow[] = [];
  let offset = 0;
  try {
    while (true) {
      const { data, error } = await client
        .from("card_reviews")
        .select(
          "card_type,subject_key,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,fsrs_state,due_date,last_review,first_seen,hidden_since,seen_in_pasture,updated_at"
        )
        .eq("user_id", userId)
        .range(offset, offset + PAGE - 1);
      if (error || !data) return null;
      // Skip rows with null subject_key — these are unmigrated edge rows that
      // will be re-pushed on the next sync after the app-side backfill runs.
      const rows = (data as CloudRow[]).filter((r) => r.subject_key !== null);
      allRows.push(...rows);
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return allRows;
  } catch {
    return null;
  }
}

/**
 * Returns the most-recently-updated cloud row's `updated_at` timestamp, or the
 * current time as a fallback when no rows have one. Used to anchor `lastPullAt`
 * to a server-derived value rather than the local clock, which protects the
 * conflict-resolution rule from clock skew.
 */
export function maxCloudUpdatedAt(rows: CloudRow[]): string {
  if (rows.length === 0) return new Date().toISOString();
  return rows.reduce<string>((max, r) => {
    if (!r.updated_at) return max;
    return r.updated_at > max ? r.updated_at : max;
  }, rows[0].updated_at ?? new Date().toISOString());
}

/**
 * Serialises cards to a Blob suitable for navigator.sendBeacon('/api/sync', blob).
 * Content-Type is set to application/json via the Blob constructor — sendBeacon
 * does not accept a headers option, so this is the only way to set it.
 */
export function buildBeaconPayload(cards: ReviewableCard[]): Blob {
  const safeRows = cards.filter(isSyncSafe).map(toCloudRow);
  return new Blob([JSON.stringify({ cards: safeRows })], { type: "application/json" });
}

/**
 * Applies a single cloud row's FSRS fields onto a local card, preserving
 * in-memory-only fields (learningStep, stepStartedAt). Normalizes invariant
 * violations (firstSeen set but lastReview null) the same way mergeCloudIntoLocal does.
 */
function applyCloudRow(card: ReviewableCard, row: CloudRow): ReviewableCard {
  // Legacy cloud rows (pre-migration 007) won't have hidden_since on the
  // wire — treat undefined as null so the normalised local state always
  // has the field set to a concrete value.
  const hiddenSince = row.hidden_since ?? null;
  // Legacy cloud rows (pre-migration 008) won't have seen_in_pasture on the
  // wire — treat undefined as false.
  const seenInPasture = row.seen_in_pasture ?? false;
  if (row.first_seen !== null && row.last_review === null) {
    console.warn(
      `[sync] normalizing card ${row.card_type}:${row.subject_key}: cloud row has firstSeen=${row.first_seen} but lastReview=null — clearing firstSeen`
    );
    return {
      ...card,
      state: {
        ...card.state,
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new",
        dueDate: row.due_date,
        lastReview: null,
        firstSeen: null,
        hiddenSince,
        // A card reset to new-card state is not in the pasture.
        seenInPasture: false,
      },
    };
  }
  return {
    ...card,
    state: {
      ...card.state,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsedDays: row.elapsed_days,
      scheduledDays: row.scheduled_days,
      reps: row.reps,
      lapses: row.lapses,
      fsrsState: row.fsrs_state,
      dueDate: row.due_date,
      lastReview: row.last_review,
      firstSeen: row.first_seen,
      hiddenSince,
      seenInPasture,
    },
  };
}

/**
 * Silent background-pull merge. Per-card conflict rule:
 *   - lastPullAt is null AND local card has no progress (lastReview === null
 *     && firstSeen === null): cloud wins. Bootstrap for cards still pristine.
 *   - lastPullAt is null AND local card has any progress: keep local. Without
 *     a pull anchor we cannot reason about which side is newer, so any local
 *     state that represents user effort is protected (closes #359).
 *   - card.state.lastReview >= lastPullAt.slice(0,10): this device graded
 *     since the last pull → keep local.
 *   - cloud row's updated_at > lastPullAt: cloud has newer state → take cloud.
 *   - otherwise: cloud row unchanged since last pull → keep local.
 *
 * The >= date comparison is conservative: a review on the same calendar day as
 * the pull counts as "graded since pull," preventing incorrect reverts in
 * same-day scenarios.
 */
/** Returns a composite key for a cloud row to match against local cards. */
function cloudRowKey(r: CloudRow): string {
  return `${r.card_type}:${r.subject_key ?? ""}`;
}

/** Returns the same composite key for a local card. */
function cardKey(card: ReviewableCard): string {
  return `${appTypeToDbType(card.cardType)}:${card.subjectKey}`;
}

export function mergeCloudIntoLocalSilent(
  local: ReviewableCard[],
  cloud: CloudRow[],
  lastPullAt: string | null,
): ReviewableCard[] {
  const byKey = new Map(cloud.map((r) => [cloudRowKey(r), r]));
  return local.map((card) => {
    const row = byKey.get(cardKey(card));
    if (!row) return card;

    if (lastPullAt === null) {
      // No pull anchor. Cloud can only seed cards that have never been
      // touched locally; anything with progress is preserved.
      if (card.state.lastReview !== null || card.state.firstSeen !== null) {
        return card;
      }
      return applyCloudRow(card, row);
    }

    const pullDate = lastPullAt.slice(0, 10);
    const localLastReview = card.state.lastReview;

    // Local has a review on the same calendar day as the pull or later — keep local.
    if (localLastReview !== null && localLastReview >= pullDate) {
      return card;
    }

    // Cloud row updated after the last pull — take cloud.
    // When updated_at is absent (legacy row), conservatively treat as newer.
    if (!row.updated_at || row.updated_at > lastPullAt) {
      return applyCloudRow(card, row);
    }

    // Cloud row unchanged since last pull — keep local.
    return card;
  });
}

/**
 * Merges cloud rows into a local card array. For each card, if a matching
 * cloud row exists (keyed by `(card_type, subject_key)`), its FSRS state
 * fields overwrite the local state. Cards without a cloud counterpart are
 * returned unchanged. The merge is non-destructive: in-memory-only fields
 * (learningStep, stepStartedAt) are preserved from the local card.
 *
 * Cloud rows that violate the firstSeen/lastReview invariant are normalized on
 * read: firstSeen is cleared so the card re-enters the new-card queue rather
 * than appearing as "introduced but never reviewed" in stats.
 */
export function mergeCloudIntoLocal(
  local: ReviewableCard[],
  cloud: CloudRow[],
): ReviewableCard[] {
  const byKey = new Map(cloud.map((r) => [cloudRowKey(r), r]));
  return local.map((card) => {
    const row = byKey.get(cardKey(card));
    if (!row) return card;
    return applyCloudRow(card, row);
  });
}

/**
 * Rebuilds the full card set from seed at initial state, then overlays every
 * cloud row that matches a card via `applyCloudRow`. Cards present in cloud
 * get cloud state; cards absent from cloud are returned at initial ("new")
 * state. This is a cloud-authoritative pull: local progress that has no
 * counterpart in the cloud is discarded.
 *
 * Use this instead of `mergeCloudIntoLocal` when the intent is "cloud is the
 * source of truth" — e.g. superuser exit cleanup (wiping QA drift) or the
 * "Keep cloud" branch of the conflict picker on a new device.
 */
export function applyCloudAuthoritative(
  seed: readonly SeedPokemon[],
  evoSeed: readonly EvolutionCard[],
  cloud: CloudRow[],
  opts: SeedOpts,
  now: Date = new Date(),
): ReviewableCard[] {
  const base = buildSession(seed, evoSeed, now, opts);
  const byKey = new Map(cloud.map((r) => [cloudRowKey(r), r]));
  return base.map((card) => {
    const row = byKey.get(cardKey(card));
    if (!row) return card;
    return applyCloudRow(card, row);
  });
}
