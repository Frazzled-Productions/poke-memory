import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";

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

// pokemon_id encoding:
//   Standard Pokémon:  pokemon_id = Pokédex number (1–1025)
//   Evolution cards:   pokemon_id = EVOLUTION_ID_OFFSET + pokédex_number (≥ 1_000_001)
// The round-trip works because push and pull match on the same value, but any
// direct SQL query against card_reviews must account for the offset.
export type CloudRow = {
  pokemon_id: number;
  repetitions: number;
  interval: number;
  ease_factor: number;
  due_date: string;
  last_review: string | null;
  first_seen: string | null;
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
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .limit(1);
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

// FSRS state ↔ SM-2-shaped CloudRow adapter. The cloud schema is still on
// SM-2 columns until issue #264 lands; until then we encode FSRS-shape state
// onto the SM-2 columns lossily on push and reverse the conversion on pull.
//
// Outbound (push) mapping:
//   repetitions ← reps
//   interval    ← scheduledDays
//   ease_factor ← 2.5 - (difficulty - 1) * 1.2 / 9   (FSRS difficulty 1..10 → SM-2 ease 2.5..1.3)
// Inbound (pull) mapping mirrors the localStorage migration in
// `migrateReviewState`: a graduated SM-2 row maps to stability=interval,
// difficulty inverted from ease_factor, fsrsState='review'.
function fsrsStateToSm2Fields(state: ReviewableCard["state"]): {
  repetitions: number;
  interval: number;
  ease_factor: number;
} {
  const ease = 2.5 - ((state.difficulty - 1) * 1.2) / 9;
  return {
    repetitions: state.reps,
    interval: state.scheduledDays,
    ease_factor: Math.min(2.5, Math.max(1.3, ease)),
  };
}

function sm2FieldsToFsrsState(
  row: Pick<CloudRow, "repetitions" | "interval" | "ease_factor" | "last_review">,
): Pick<
  ReviewableCard["state"],
  "stability" | "difficulty" | "elapsedDays" | "scheduledDays" | "reps" | "lapses" | "fsrsState"
> {
  const isGraduated = row.repetitions > 0 || row.last_review !== null;
  if (!isGraduated) {
    return {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "new",
    };
  }
  const raw = 10 - (9 * (row.ease_factor - 1.3)) / 1.2;
  return {
    stability: Math.max(1, row.interval),
    difficulty: Math.min(10, Math.max(1, raw)),
    elapsedDays: 0,
    scheduledDays: row.interval,
    reps: row.repetitions,
    lapses: 0,
    fsrsState: "review",
  };
}

function toCloudRow(card: ReviewableCard): CloudRow {
  const sm2 = fsrsStateToSm2Fields(card.state);
  return {
    pokemon_id: card.id,
    repetitions: sm2.repetitions,
    interval: sm2.interval,
    ease_factor: sm2.ease_factor,
    due_date: card.state.dueDate,
    last_review: card.state.lastReview,
    first_seen: card.state.firstSeen,
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
      `[sync] skipping card ${card.id}: firstSeen set but lastReview null (in-step, not graduated)`
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
        .upsert(batch, { onConflict: "user_id,pokemon_id" });
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
      `[sync] skipping card ${card.id}: firstSeen set but lastReview null (in-step, not graduated)`
    );
    return false;
  }
  try {
    const sm2 = fsrsStateToSm2Fields(card.state);
    const { error } = await client.from("card_reviews").upsert(
      {
        user_id: userId,
        pokemon_id: card.id,
        repetitions: sm2.repetitions,
        interval: sm2.interval,
        ease_factor: sm2.ease_factor,
        due_date: card.state.dueDate,
        last_review: card.state.lastReview,
        first_seen: card.state.firstSeen,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,pokemon_id" },
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Deletes all card_review rows for the user from the cloud.
 * Returns true on success, false on any error.
 */
export async function deleteAllCloudProgress(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  try {
    const { error } = await client
      .from("card_reviews")
      .delete()
      .eq("user_id", userId);
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
          "pokemon_id,repetitions,interval,ease_factor,due_date,last_review,first_seen,updated_at"
        )
        .eq("user_id", userId)
        .range(offset, offset + PAGE - 1);
      if (error || !data) return null;
      allRows.push(...(data as CloudRow[]));
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return allRows;
  } catch {
    return null;
  }
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
 * Applies a single cloud row's SM-2 fields onto a local card, preserving
 * in-memory-only fields (learningStep, stepStartedAt). Normalizes invariant
 * violations (firstSeen set but lastReview null) the same way mergeCloudIntoLocal does.
 */
function applyCloudRow(card: ReviewableCard, row: CloudRow): ReviewableCard {
  if (row.first_seen !== null && row.last_review === null) {
    console.warn(
      `[sync] normalizing card ${card.id}: cloud row has firstSeen=${row.first_seen} but lastReview=null — clearing firstSeen`
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
      },
    };
  }
  const fsrs = sm2FieldsToFsrsState(row);
  return {
    ...card,
    state: {
      ...card.state,
      ...fsrs,
      dueDate: row.due_date,
      lastReview: row.last_review,
      firstSeen: row.first_seen,
    },
  };
}

/**
 * Silent background-pull merge. Per-card conflict rule:
 *   - lastPullAt is null (first pull): cloud wins unconditionally.
 *   - card.state.lastReview >= lastPullAt.slice(0,10): this device graded
 *     since the last pull → keep local.
 *   - cloud row's updated_at > lastPullAt: cloud has newer state → take cloud.
 *   - otherwise: cloud row unchanged since last pull → keep local.
 *
 * The >= date comparison is conservative: a review on the same calendar day as
 * the pull counts as "graded since pull," preventing incorrect reverts in
 * same-day scenarios.
 */
export function mergeCloudIntoLocalSilent(
  local: ReviewableCard[],
  cloud: CloudRow[],
  lastPullAt: string | null,
): ReviewableCard[] {
  const byId = new Map(cloud.map((r) => [r.pokemon_id, r]));
  return local.map((card) => {
    const row = byId.get(card.id);
    if (!row) return card;

    if (lastPullAt === null) {
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
 * cloud row exists (keyed by pokemon_id / card.id), its SM-2 state fields
 * overwrite the local state. Cards without a cloud counterpart are returned
 * unchanged. The merge is non-destructive: in-memory-only fields
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
  const byId = new Map(cloud.map((r) => [r.pokemon_id, r]));
  return local.map((card) => {
    const row = byId.get(card.id);
    if (!row) return card;
    return applyCloudRow(card, row);
  });
}
