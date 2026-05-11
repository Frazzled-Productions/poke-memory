import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";

// Sync is best-effort: all errors are swallowed so a network hiccup never
// breaks the local-first review flow.

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

/**
 * Pushes the full local session to the cloud via batched upserts.
 * Returns true if all batches succeeded, false if any batch failed.
 * learningStep and stepStartedAt are in-memory only and are not persisted.
 */
export async function pushSession(
  client: SupabaseClient,
  userId: string,
  cards: ReviewableCard[],
): Promise<boolean> {
  const rows: CloudRow[] = cards.map((card) => ({
    pokemon_id: card.id,
    repetitions: card.state.repetitions,
    interval: card.state.interval,
    ease_factor: card.state.easeFactor,
    due_date: card.state.dueDate,
    last_review: card.state.lastReview,
    first_seen: card.state.firstSeen,
  }));

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
 * error without throwing.
 */
export async function pushSingleCard(
  client: SupabaseClient,
  userId: string,
  card: ReviewableCard,
): Promise<boolean> {
  try {
    const { error } = await client.from("card_reviews").upsert(
      {
        user_id: userId,
        pokemon_id: card.id,
        repetitions: card.state.repetitions,
        interval: card.state.interval,
        ease_factor: card.state.easeFactor,
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
          "pokemon_id,repetitions,interval,ease_factor,due_date,last_review,first_seen"
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
  const rows: CloudRow[] = cards.map((card) => ({
    pokemon_id: card.id,
    repetitions: card.state.repetitions,
    interval: card.state.interval,
    ease_factor: card.state.easeFactor,
    due_date: card.state.dueDate,
    last_review: card.state.lastReview,
    first_seen: card.state.firstSeen,
  }));
  return new Blob([JSON.stringify({ cards: rows })], { type: "application/json" });
}

/**
 * Merges cloud rows into a local card array. For each card, if a matching
 * cloud row exists (keyed by pokemon_id / card.id), its SM-2 state fields
 * overwrite the local state. Cards without a cloud counterpart are returned
 * unchanged. The merge is non-destructive: in-memory-only fields
 * (learningStep, stepStartedAt) are preserved from the local card.
 */
export function mergeCloudIntoLocal(
  local: ReviewableCard[],
  cloud: CloudRow[],
): ReviewableCard[] {
  const byId = new Map(cloud.map((r) => [r.pokemon_id, r]));
  return local.map((card) => {
    const row = byId.get(card.id);
    if (!row) return card;
    return {
      ...card,
      state: {
        ...card.state,
        repetitions: row.repetitions,
        interval: row.interval,
        easeFactor: row.ease_factor,
        dueDate: row.due_date,
        lastReview: row.last_review,
        firstSeen: row.first_seen,
      },
    };
  });
}
