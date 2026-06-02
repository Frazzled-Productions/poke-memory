import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type {
  ReviewableCard,
  BuildSessionOpts,
  NameReviewCard,
  EvolutionReviewCard,
  ReverseEvolutionReviewCard,
  ReverseReviewCard,
  CryReviewCard,
} from "@/lib/review/session";
import { buildSession } from "@/lib/review/session";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { SeedPokemon, EvolutionCard } from "@/lib/pokemon/seed";
import { reverseEdgeIdFor, REVERSE_ID_OFFSET, CRY_ID_OFFSET } from "@/lib/pokemon/seed";
import { Subject, appTypeToDbType, dbTypeToAppType } from "@/lib/cards/subjectKey";
import { markStructuralSyncError, clearStructuralSyncError } from "@/lib/sync/structuralError";
import type { AppLocale } from "@/i18n/locales";

// cloud.ts imports markStructuralSyncError from structuralError.ts — a leaf
// module that has no imports from cloud.ts or persistence.ts — so there is no
// circular dependency. persistence.ts re-exports those helpers from the same
// leaf for callers that already import from persistence.ts.

/** Options forwarded to `buildSession` when rebuilding a card set from seed. */
export type SeedOpts = BuildSessionOpts;

/**
 * The `onConflict` column list for `card_reviews` upserts.
 *
 * Must exactly match the table's PRIMARY KEY: (user_id, card_type, subject_key, locale).
 * Migration 029 widened the PK from 3 columns to 4 (adding locale). Exporting
 * this constant — and importing it at every upsert call site (cloud.ts + route.ts)
 * — means the integration test in lib/sync/integration/onconflict-pk-parity.test.ts
 * mechanically catches any future PK change that is not matched by a client update.
 * That is the safeguard that would have caught the #1344 silent-outage shape at CI time.
 */
export const CARD_REVIEWS_CONFLICT_COLS =
  "user_id,card_type,subject_key,locale" as const;

/**
 * Returns true when a PostgrestError code indicates a structural (non-transient)
 * failure on the card_reviews write path (#1358).
 *
 * Structural codes:
 *   42xxx — schema/SQL errors (42P10 ON CONFLICT mismatch, 42P01 relation
 *            not found, 42703 column not found, 42501 insufficient privilege
 *            at the PG layer). These always mean a deploy/schema mismatch and
 *            are NEVER transient.
 *   23505 — unique_violation. Upsert should never produce this unless the
 *            conflict target is wrong.
 *   23503 — foreign_key_violation.
 *
 * Excluded from this predicate:
 *   23514 — check_violation. This is the regression trigger (migration 002 /
 *            015 / 016 / 017), a DELIBERATE DB guard. Treat as best-effort/skip
 *            (the trigger rejects bad state — that's the intended behaviour).
 *   PGRST* — PostgREST HTTP-layer codes, transient during schema-cache reload.
 *   Network TypeErrors — land in the catch block, not error.code. Best-effort.
 *   Generic 5xx — transient; retrying is appropriate.
 *
 * IMPORTANT: Only call this from the card_reviews primary path. Auxiliary legs
 * (pushSettings, pushStreak, pushGradeLog, pushRegionalPrefs) must warn-and-
 * continue regardless of error code.
 */
export function isStructuralError(error: PostgrestError | null): boolean {
  if (!error) return false;
  const code = error.code;
  if (typeof code !== "string") return false;
  // Exclude 23514 (check_violation — deliberate regression trigger).
  if (code === "23514") return false;
  // Exclude PGRST-prefixed PostgREST HTTP-layer codes (transient schema-cache).
  if (code.startsWith("PGRST")) return false;
  // All 42xxx schema errors are structural.
  if (code.startsWith("42")) return true;
  // Unique and FK violations on the cards path are structural.
  if (code === "23505" || code === "23503") return true;
  return false;
}

// Sync is best-effort for transient errors. Structural errors on the
// card_reviews primary path call markStructuralSyncError directly (#1358).

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
 * Cloud row shape after migration 029 (locale column added).
 *
 * Primary identity: (card_type, subject_key, locale).
 *   card_type   — DB discriminator (e.g. "name", "evolution-edge"). Note: the
 *                 app internally uses "evolution" / "reverse-evolution"; these
 *                 are mapped by appTypeToDbType / dbTypeToAppType.
 *   subject_key — type-specific opaque key: species ID string for species cards,
 *                 "fromId>>>toId" for edge cards.
 *   locale      — Pokémon-name locale for this FSRS row (#1259).
 *
 * The legacy `pokemon_id` integer column was dropped by migration 012. Push
 * paths upsert via `(user_id, card_type, subject_key, locale)` and never write
 * `pokemon_id` — it does not exist on the table.
 */
export type CloudRow = {
  /** DB card_type discriminator. Use appTypeToDbType / dbTypeToAppType to convert to/from app types. */
  card_type: string;
  /** Type-specific identity key. Null for unmigrated edge rows (skipped on pull). */
  subject_key: string | null;
  /**
   * Pokémon-name locale for this FSRS row (#1259). Each locale gets independent
   * FSRS state. Defaults to "en" for rows written before migration 029.
   * Optional so pre-migration cloud rows (which lack this column) are still
   * type-safe — all pull paths default to "en" via `row.locale ?? "en"`.
   */
  locale?: string;
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
    locale: card.locale ?? "en",
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
 * Projects an array of ReviewableCards to CloudRow[] (snake_case, with
 * appTypeToDbType applied). Skips cards that violate the isSyncSafe invariant
 * (firstSeen set but lastReview null — in-step cards).
 *
 * Exported so callers that need the cloud-row shape without constructing a
 * Blob (e.g. the IDB mirror written by savePendingQueue for the service worker)
 * can use the same projection as buildBeaconPayload without re-implementing it.
 */
export function toCloudRows(cards: ReviewableCard[]): CloudRow[] {
  return cards.filter(isSyncSafe).map(toCloudRow);
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
        .upsert(batch, { onConflict: CARD_REVIEWS_CONFLICT_COLS });
      if (error) {
        allOk = false;
        if (isStructuralError(error)) {
          // Structural errors are never transient — fail loud immediately rather
          // than swallowing as best-effort (#1358). console.error reaches error
          // monitoring; markStructuralSyncError persists the code directly so
          // no caller-must-pop indirection is needed.
          console.error(
            `[sync] structural error on card_reviews upsert (SQLSTATE ${error.code}): ${error.message}`
          );
          markStructuralSyncError(error.code);
          // Break early — retrying a structural error is pointless until a
          // deploy fixes the mismatch.
          break;
        }
      }
    } catch {
      allOk = false;
    }
  }
  if (allOk) {
    // All batches succeeded — clear any outstanding structural error.
    // Only the card_reviews success path clears structuralSyncError; auxiliary
    // legs must not (#1358 FIX 2).
    clearStructuralSyncError();
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
        locale: card.locale ?? "en",
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
      { onConflict: CARD_REVIEWS_CONFLICT_COLS },
    );
    if (!error) {
      // Successful card_reviews push — clear any outstanding structural error.
      // This is the ONLY path that clears structuralSyncError; auxiliary-leg
      // success (pushSettings, pushStreak, etc.) must not clear it (#1358 FIX 2).
      clearStructuralSyncError();
      return true;
    }
    if (isStructuralError(error)) {
      // Structural errors are never transient — fail loud immediately (#1358).
      // console.error reaches error monitoring; markStructuralSyncError persists
      // the code directly so no caller-must-pop indirection is needed.
      console.error(
        `[sync] structural error on card_reviews upsert (SQLSTATE ${error.code}): ${error.message}`
      );
      markStructuralSyncError(error.code);
    }
    return false;
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
          "card_type,subject_key,locale,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,fsrs_state,due_date,last_review,first_seen,hidden_since,seen_in_pasture,updated_at"
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
  // Legacy cloud rows (pre-migration 029) won't have locale on the wire —
  // treat undefined as "en" so normalised local state always has the field set.
  const locale = (row.locale ?? "en") as ReviewableCard["locale"];

  if (row.first_seen !== null && row.last_review === null) {
    console.warn(
      `[sync] normalizing card ${row.card_type}:${row.subject_key}:${row.locale ?? "en"}: cloud row has firstSeen=${row.first_seen} but lastReview=null — clearing firstSeen`
    );
    return {
      ...card,
      locale,
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
    locale,
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
/**
 * Returns a composite key for a cloud row to match against local cards.
 * Includes locale so per-locale rows merge correctly (#1259).
 */
function cloudRowKey(r: CloudRow): string {
  return `${r.card_type}:${r.subject_key ?? ""}:${r.locale ?? "en"}`;
}

/**
 * Returns the same composite key for a local card.
 * Symmetric with cloudRowKey.
 */
function cardKey(card: ReviewableCard): string {
  return `${appTypeToDbType(card.cardType)}:${card.subjectKey}:${card.locale ?? "en"}`;
}

/**
 * Synthesises a fresh local card skeleton from seed data for a given cloud row.
 * Returns null when the cloud row's card_type or subject_key cannot be resolved
 * against the seed (unknown type, or species/edge not in the seed).
 *
 * Used by `mergeCloudIntoLocalSilent` to INSERT unmatched cloud rows (rows from
 * other enrolled locales) as new local cards on a fresh device pull, so every
 * language's progress is present in the local session after the first sync.
 */
function synthCardFromCloudRow(
  row: CloudRow,
  seedById: ReadonlyMap<number, SeedPokemon>,
  evoByEndpoints: ReadonlyMap<string, EvolutionCard>,
  now: Date,
): ReviewableCard | null {
  if (row.subject_key === null) return null;
  const appType = dbTypeToAppType(row.card_type);
  if (appType === null) return null;

  const locale = (row.locale ?? "en") as AppLocale;
  const baseState = initialReviewState(now);

  switch (appType) {
    case "name": {
      const speciesId = Number(row.subject_key);
      if (!Number.isInteger(speciesId) || speciesId <= 0) return null;
      const pokemon = seedById.get(speciesId);
      if (!pokemon) return null;
      const card: NameReviewCard = {
        ...pokemon,
        cardType: "name",
        subjectKey: Subject.forSpecies(speciesId),
        locale,
        state: baseState,
      };
      return applyCloudRow(card, row);
    }
    case "reverse": {
      const speciesId = Number(row.subject_key);
      if (!Number.isInteger(speciesId) || speciesId <= 0) return null;
      const pokemon = seedById.get(speciesId);
      if (!pokemon) return null;
      const card: ReverseReviewCard = {
        ...pokemon,
        id: REVERSE_ID_OFFSET + speciesId,
        pokemonId: speciesId,
        cardType: "reverse",
        subjectKey: Subject.forSpecies(speciesId),
        locale,
        state: baseState,
      };
      return applyCloudRow(card, row);
    }
    case "cry": {
      const speciesId = Number(row.subject_key);
      if (!Number.isInteger(speciesId) || speciesId <= 0) return null;
      const pokemon = seedById.get(speciesId);
      if (!pokemon) return null;
      const card: CryReviewCard = {
        ...pokemon,
        id: CRY_ID_OFFSET + speciesId,
        pokemonId: speciesId,
        cardType: "cry",
        subjectKey: Subject.forSpecies(speciesId),
        locale,
        state: baseState,
      };
      return applyCloudRow(card, row);
    }
    case "evolution": {
      const evo = evoByEndpoints.get(row.subject_key);
      if (!evo) return null;
      const card: EvolutionReviewCard = {
        ...evo,
        subjectKey: Subject.forEdge(evo.preEvoId, evo.postEvoId),
        locale,
        state: baseState,
      };
      return applyCloudRow(card, row);
    }
    case "reverse-evolution": {
      const evo = evoByEndpoints.get(row.subject_key);
      if (!evo) return null;
      const card: ReverseEvolutionReviewCard = {
        ...evo,
        cardType: "reverse-evolution",
        id: reverseEdgeIdFor(evo.id),
        subjectKey: Subject.forEdge(evo.preEvoId, evo.postEvoId),
        locale,
        state: baseState,
      };
      return applyCloudRow(card, row);
    }
    default:
      return null;
  }
}

export function mergeCloudIntoLocalSilent(
  local: ReviewableCard[],
  cloud: CloudRow[],
  lastPullAt: string | null,
  seed?: readonly SeedPokemon[],
  evoSeed?: readonly EvolutionCard[],
  now: Date = new Date(),
): ReviewableCard[] {
  const localCardKeys = new Set(local.map((c) => cardKey(c)));
  const byKey = new Map(cloud.map((r) => [cloudRowKey(r), r]));

  // Pass 1: update existing local cards from matching cloud rows (existing behaviour).
  const updated = local.map((card) => {
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

  // Pass 2: INSERT cloud rows that have no matching local card. This handles
  // the case where a user has enrolled multiple languages on another device —
  // the other-locale rows exist in the cloud but were never seeded locally
  // (local session was built for a single locale). Without this pass, a fresh
  // device pull only imports the currently-active locale's progress.
  //
  // We only synthesise cards when seed data is provided (callers in guest mode
  // or callers that deliberately omit seed pass nothing and skip this pass).
  if (seed && seed.length > 0) {
    const seedById = new Map(seed.map((p) => [p.id, p]));
    const evoByEndpoints = new Map(
      (evoSeed ?? []).map((e) => [Subject.forEdge(e.preEvoId, e.postEvoId), e]),
    );

    const insertions: ReviewableCard[] = [];
    for (const row of cloud) {
      const key = cloudRowKey(row);
      if (localCardKeys.has(key)) continue;          // already merged in Pass 1
      if (row.subject_key === null) continue;         // unmigrated edge row
      const synth = synthCardFromCloudRow(row, seedById, evoByEndpoints, now);
      if (synth !== null) {
        insertions.push(synth);
      }
    }

    if (insertions.length > 0) {
      return [...updated, ...insertions];
    }
  }

  return updated;
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
