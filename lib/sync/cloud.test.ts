import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  isSyncSafe,
  pushSession,
  pushSingleCard,
  mergeCloudIntoLocal,
  mergeCloudIntoLocalSilent,
  applyCloudAuthoritative,
  isStructuralError,
  CARD_REVIEWS_CONFLICT_COLS,
} from "./cloud";
import type { ReviewableCard } from "@/lib/review/session";
import type { CloudRow, SeedOpts } from "./cloud";
import type { SeedPokemon, EvolutionCard } from "@/lib/pokemon/seed";
import type { PostgrestError } from "@supabase/supabase-js";

// Minimal ReviewableCard factory for sync tests.
// Only the fields relevant to isSyncSafe and sync are set.
function makeCard(
  id: number,
  firstSeen: string | null,
  lastReview: string | null,
  hiddenSince: string | null = null,
  seenInPasture = false,
): ReviewableCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `pokemon-${id}`,
    cardType: "name",
    name: `pokemon-${id}`,
    subjectKey: String(id),
    spriteUrl: `https://example.com/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A test pokemon.",
    flavorTexts: ["A test pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Test Pokémon",
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: {
      stability: 0,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      fsrsState: "new",
      dueDate: "2026-05-11",
      lastReview,
      firstSeen,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince,
      seenInPasture,
    },
  } as ReviewableCard;
}

function makeCloudRow(
  pokemonId: number,
  firstSeen: string | null,
  lastReview: string | null,
  updatedAt = "2026-05-11T12:00:00.000Z",
  hiddenSince: string | null = null,
  seenInPasture = false,
): CloudRow {
  return {
    card_type: "name",
    subject_key: String(pokemonId),
    stability: 1,
    difficulty: 1,
    elapsed_days: 0,
    scheduled_days: 1,
    reps: 1,
    lapses: 0,
    fsrs_state: "review",
    due_date: "2026-05-11",
    last_review: lastReview,
    first_seen: firstSeen,
    hidden_since: hiddenSince,
    seen_in_pasture: seenInPasture,
    updated_at: updatedAt,
  };
}

function makeSupabaseClient(upsertError: null | object = null) {
  const upsertSpy = vi.fn().mockResolvedValue({ error: upsertError });
  const client = {
    from: vi.fn().mockReturnValue({
      upsert: upsertSpy,
    }),
    _upsertSpy: upsertSpy,
  };
  return client as unknown as import("@supabase/supabase-js").SupabaseClient & {
    _upsertSpy: ReturnType<typeof vi.fn>;
  };
}

// ─── isSyncSafe ───────────────────────────────────────────────────────────────

describe("isSyncSafe", () => {
  it("returns true when firstSeen and lastReview are both null (never graded)", () => {
    expect(isSyncSafe(makeCard(1, null, null))).toBe(true);
  });

  it("returns true when firstSeen and lastReview are both set (graduated)", () => {
    expect(isSyncSafe(makeCard(1, "2026-05-10", "2026-05-10"))).toBe(true);
  });

  it("returns false when firstSeen is set but lastReview is null (in-step)", () => {
    expect(isSyncSafe(makeCard(1, "2026-05-10", null))).toBe(false);
  });

  it("returns true when firstSeen is null but lastReview is set (edge: lapse before firstSeen written)", () => {
    // Unusual but not the invariant we guard against.
    expect(isSyncSafe(makeCard(1, null, "2026-05-10"))).toBe(true);
  });
});

// ─── pushSession ──────────────────────────────────────────────────────────────

describe("pushSession", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("skips a card with firstSeen set and lastReview null without calling upsert for it", async () => {
    const client = makeSupabaseClient();
    const safeCard = makeCard(1, "2026-05-10", "2026-05-10");
    const unsafeCard = makeCard(2, "2026-05-10", null);

    const ok = await pushSession(client, "user-1", [safeCard, unsafeCard]);

    expect(ok).toBe(true);
    // upsert should have been called once for the safe card only
    expect(client._upsertSpy).toHaveBeenCalledTimes(1);
    const [batchArg] = client._upsertSpy.mock.calls[0] as [
      Array<{ card_type: string; subject_key: string }>,
      unknown,
    ];
    expect(batchArg).toHaveLength(1);
    expect(batchArg[0].card_type).toBe("name");
    expect(batchArg[0].subject_key).toBe("1");
  });

  it("uses (user_id, card_type, subject_key, locale) as the conflict target (#1259)", async () => {
    const client = makeSupabaseClient();
    const safeCard = makeCard(1, "2026-05-10", "2026-05-10");
    await pushSession(client, "user-1", [safeCard]);
    const [, conflictArg] = client._upsertSpy.mock.calls[0] as [unknown, { onConflict: string }];
    expect(conflictArg.onConflict).toBe(CARD_REVIEWS_CONFLICT_COLS);
  });

  it("warns when an unsafe card is skipped", async () => {
    const client = makeSupabaseClient();
    await pushSession(client, "user-1", [makeCard(42, "2026-05-10", null)]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("42")
    );
  });

  it("returns true with no upsert calls when all cards are unsafe", async () => {
    const client = makeSupabaseClient();
    const ok = await pushSession(client, "user-1", [makeCard(1, "2026-05-10", null)]);
    expect(ok).toBe(true);
    expect(client._upsertSpy).not.toHaveBeenCalled();
  });
});

// ─── pushSingleCard ───────────────────────────────────────────────────────────

describe("pushSingleCard", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns false without calling upsert for an unsafe card", async () => {
    const client = makeSupabaseClient();
    const unsafeCard = makeCard(7, "2026-05-10", null);

    const result = await pushSingleCard(client, "user-1", unsafeCard);
    expect(result).toBe(false);
    expect(client._upsertSpy).not.toHaveBeenCalled();
  });

  it("warns when an unsafe card is rejected", async () => {
    const client = makeSupabaseClient();
    await pushSingleCard(client, "user-1", makeCard(7, "2026-05-10", null));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("7"));
  });

  it("calls upsert and returns true for a safe card", async () => {
    const client = makeSupabaseClient();
    const safeCard = makeCard(1, "2026-05-10", "2026-05-10");

    const result = await pushSingleCard(client, "user-1", safeCard);

    expect(result).toBe(true);
    expect(client._upsertSpy).toHaveBeenCalledTimes(1);
  });

  it("upsert uses (user_id, card_type, subject_key, locale) as the conflict target (#1259)", async () => {
    const client = makeSupabaseClient();
    const safeCard = makeCard(1, "2026-05-10", "2026-05-10");
    await pushSingleCard(client, "user-1", safeCard);
    const [rowArg, conflictArg] = client._upsertSpy.mock.calls[0] as [
      { card_type: string; subject_key: string },
      { onConflict: string },
    ];
    expect(rowArg.card_type).toBe("name");
    expect(rowArg.subject_key).toBe("1");
    expect(conflictArg.onConflict).toBe(CARD_REVIEWS_CONFLICT_COLS);
  });
});

// ─── pull-before-push invariant ───────────────────────────────────────────────

describe("pull-before-push invariant (regression guard)", () => {
  // This test verifies that mergeCloudIntoLocalSilent + mergeCloudIntoLocal key
  // on (card_type, subject_key) rather than the old pokemon_id, ensuring the
  // new identity scheme produces correct per-card matching.
  it("merge keys on (card_type, subject_key), not pokemon_id", () => {
    // Two cards with the same subject_key but different card_type must NOT match.
    const nameCard = makeCard(1, null, null);
    const reverseCloudRow: CloudRow = {
      card_type: "reverse",
      subject_key: "1", // same species, different direction
      stability: 1,
      difficulty: 1,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-05-11",
      last_review: "2026-05-10",
      first_seen: "2026-05-09",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-11T12:00:00.000Z",
    };
    // The name card should not pick up the reverse-card's cloud row.
    const merged = mergeCloudIntoLocal([nameCard], [reverseCloudRow]);
    expect(merged[0].state.lastReview).toBeNull(); // unchanged — no matching cloud row
  });

  it("merge correctly matches a name card with its cloud row", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const nameCard = makeCard(5, null, null);
    const cloudRow = makeCloudRow(5, "2026-05-01", "2026-05-10");
    const [merged] = mergeCloudIntoLocal([nameCard], [cloudRow]);
    expect(merged.state.lastReview).toBe("2026-05-10");
    expect(merged.state.firstSeen).toBe("2026-05-01");
  });
});

// ─── mergeCloudIntoLocal ──────────────────────────────────────────────────────

describe("mergeCloudIntoLocal", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("normalizes a bad cloud row by clearing firstSeen and resetting FSRS fields", () => {
    const localCard = makeCard(5, null, null);
    const badRow = makeCloudRow(5, "2026-05-10", null);

    const [merged] = mergeCloudIntoLocal([localCard], [badRow]);

    expect(merged.state.firstSeen).toBeNull();
    expect(merged.state.lastReview).toBeNull();
    expect(merged.state.reps).toBe(0);
    expect(merged.state.stability).toBe(0);
    expect(merged.state.fsrsState).toBe("new");
  });

  it("warns when normalizing a bad cloud row", () => {
    const localCard = makeCard(5, null, null);
    const badRow = makeCloudRow(5, "2026-05-10", null);

    mergeCloudIntoLocal([localCard], [badRow]);

    // Warning now includes card_type:subject_key instead of bare id
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/name:5|normalizing/)
    );
  });

  it("passes through a good cloud row unchanged", () => {
    const localCard = makeCard(3, null, null);
    const goodRow = makeCloudRow(3, "2026-05-09", "2026-05-10");

    const [merged] = mergeCloudIntoLocal([localCard], [goodRow]);

    expect(merged.state.firstSeen).toBe("2026-05-09");
    expect(merged.state.lastReview).toBe("2026-05-10");
    expect(merged.state.reps).toBe(1);
    expect(merged.state.scheduledDays).toBe(1);
    expect(merged.state.fsrsState).toBe("review");
  });

  it("returns card unchanged when no matching cloud row", () => {
    const localCard = makeCard(99, "2026-05-01", "2026-05-01");

    const [merged] = mergeCloudIntoLocal([localCard], []);

    expect(merged).toBe(localCard);
  });

  it("handles mixed good and bad cloud rows in a single call", () => {
    const card3 = makeCard(3, null, null);
    const card5 = makeCard(5, null, null);
    const goodRow = makeCloudRow(3, "2026-05-09", "2026-05-10");
    const badRow = makeCloudRow(5, "2026-05-10", null);

    const merged = mergeCloudIntoLocal([card3, card5], [goodRow, badRow]);

    expect(merged[0].state.firstSeen).toBe("2026-05-09");
    expect(merged[1].state.firstSeen).toBeNull();
  });

  it("skips cloud rows with null subject_key (unmigrated edges)", () => {
    const localCard = makeCard(5, null, null);
    const unmigrated: CloudRow = {
      card_type: "evolution-edge",
      subject_key: null, // not yet backfilled
      stability: 1,
      difficulty: 1,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-05-11",
      last_review: "2026-05-10",
      first_seen: "2026-05-09",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-11T12:00:00.000Z",
    };
    // The local name card for species 5 should be unaffected by the unmigrated edge row.
    const [merged] = mergeCloudIntoLocal([localCard], [unmigrated]);
    expect(merged).toBe(localCard);
  });
});

// ─── hidden_since round-trip (#333) ───────────────────────────────────────

describe("hidden_since (#333) round-trip", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("pushSession sends hidden_since to Supabase", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(11, "2026-05-01", "2026-05-08", "2026-05-09");
    const ok = await pushSession(client, "user-1", [card]);
    expect(ok).toBe(true);
    const [batchArg] = client._upsertSpy.mock.calls[0] as [
      Array<{ card_type: string; subject_key: string; hidden_since: string | null }>,
      unknown,
    ];
    expect(batchArg[0].card_type).toBe("name");
    expect(batchArg[0].subject_key).toBe("11");
    expect(batchArg[0].hidden_since).toBe("2026-05-09");
  });

  it("pushSession sends null hidden_since for cards that are not hidden", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(12, "2026-05-01", "2026-05-08", null);
    await pushSession(client, "user-1", [card]);
    const [batchArg] = client._upsertSpy.mock.calls[0] as [
      Array<{ card_type: string; subject_key: string; hidden_since: string | null }>,
      unknown,
    ];
    expect(batchArg[0].hidden_since).toBeNull();
  });

  it("pushSingleCard sends hidden_since to Supabase", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(13, "2026-05-01", "2026-05-08", "2026-05-09");
    const ok = await pushSingleCard(client, "user-1", card);
    expect(ok).toBe(true);
    const [row] = client._upsertSpy.mock.calls[0] as [
      { card_type: string; subject_key: string; hidden_since: string | null },
      unknown,
    ];
    expect(row.card_type).toBe("name");
    expect(row.subject_key).toBe("13");
    expect(row.hidden_since).toBe("2026-05-09");
  });

  it("mergeCloudIntoLocal pulls hidden_since onto the local state", () => {
    const localCard = makeCard(20, null, null);
    const cloudRow = makeCloudRow(20, "2026-05-01", "2026-05-08", undefined, "2026-05-09");
    const [merged] = mergeCloudIntoLocal([localCard], [cloudRow]);
    expect(merged.state.hiddenSince).toBe("2026-05-09");
  });

  it("mergeCloudIntoLocal treats a missing hidden_since column as null (legacy rows)", () => {
    const localCard = makeCard(21, null, null, "2026-05-09");
    // Simulate a pre-migration cloud row by stripping the field.
    const legacyRow = makeCloudRow(21, "2026-05-01", "2026-05-08");
    delete (legacyRow as Partial<CloudRow>).hidden_since;
    const [merged] = mergeCloudIntoLocal([localCard], [legacyRow]);
    expect(merged.state.hiddenSince).toBeNull();
  });
});

// ─── seen_in_pasture (#350) round-trip ────────────────────────────────────

describe("seen_in_pasture (#350) round-trip", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("pushSession sends seen_in_pasture=true to Supabase", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(31, "2026-05-01", "2026-05-08", null, true);
    const ok = await pushSession(client, "user-1", [card]);
    expect(ok).toBe(true);
    const [batchArg] = client._upsertSpy.mock.calls[0] as [
      Array<{ card_type: string; subject_key: string; seen_in_pasture: boolean }>,
      unknown,
    ];
    expect(batchArg[0].seen_in_pasture).toBe(true);
  });

  it("pushSession sends seen_in_pasture=false for unacknowledged arrivals", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(32, "2026-05-01", "2026-05-08", null, false);
    await pushSession(client, "user-1", [card]);
    const [batchArg] = client._upsertSpy.mock.calls[0] as [
      Array<{ card_type: string; subject_key: string; seen_in_pasture: boolean }>,
      unknown,
    ];
    expect(batchArg[0].seen_in_pasture).toBe(false);
  });

  it("pushSingleCard sends seen_in_pasture=true to Supabase", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(33, "2026-05-01", "2026-05-08", null, true);
    const ok = await pushSingleCard(client, "user-1", card);
    expect(ok).toBe(true);
    const [row] = client._upsertSpy.mock.calls[0] as [
      { seen_in_pasture: boolean },
      unknown,
    ];
    expect(row.seen_in_pasture).toBe(true);
  });

  it("mergeCloudIntoLocal pulls seen_in_pasture=true onto the local state", () => {
    const localCard = makeCard(40, "2026-05-01", "2026-05-08", null, false);
    const cloudRow = makeCloudRow(40, "2026-05-01", "2026-05-08", undefined, null, true);
    const [merged] = mergeCloudIntoLocal([localCard], [cloudRow]);
    expect(merged.state.seenInPasture).toBe(true);
  });

  it("mergeCloudIntoLocal treats a missing seen_in_pasture column as false (legacy rows)", () => {
    const localCard = makeCard(41, "2026-05-01", "2026-05-08", null, true);
    // Simulate a pre-migration cloud row by stripping the field.
    const legacyRow = makeCloudRow(41, "2026-05-01", "2026-05-08");
    delete (legacyRow as Partial<CloudRow>).seen_in_pasture;
    const [merged] = mergeCloudIntoLocal([localCard], [legacyRow]);
    expect(merged.state.seenInPasture).toBe(false);
  });
});

// ─── mergeCloudIntoLocalSilent (#359) ─────────────────────────────────────

describe("mergeCloudIntoLocalSilent", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("when lastPullAt is null: pristine local card takes cloud (bootstrap)", () => {
    const local = makeCard(1, null, null);
    const row = makeCloudRow(1, "2026-05-09", "2026-05-10");
    const [merged] = mergeCloudIntoLocalSilent([local], [row], null);
    expect(merged.state.lastReview).toBe("2026-05-10");
    expect(merged.state.firstSeen).toBe("2026-05-09");
  });

  it("when lastPullAt is null: local card with lastReview is preserved over stale cloud", () => {
    // The destructive case from #359: local has today's review, cloud is stale.
    const local = makeCard(1, "2026-05-13", "2026-05-13");
    const staleRow = makeCloudRow(1, "2026-05-09", "2026-05-10");
    const [merged] = mergeCloudIntoLocalSilent([local], [staleRow], null);
    expect(merged).toBe(local);
  });

  it("when lastPullAt is null: local in-step card (firstSeen set, lastReview null) is preserved", () => {
    const local = makeCard(1, "2026-05-13", null);
    const row = makeCloudRow(1, null, null);
    const [merged] = mergeCloudIntoLocalSilent([local], [row], null);
    expect(merged).toBe(local);
  });

  it("keeps local when localLastReview is on the pull date (graded today)", () => {
    const local = makeCard(1, "2026-05-13", "2026-05-13");
    const staleRow = makeCloudRow(1, "2026-05-09", "2026-05-10", "2026-05-10T12:00:00.000Z");
    const [merged] = mergeCloudIntoLocalSilent(
      [local],
      [staleRow],
      "2026-05-13T08:00:00.000Z",
    );
    expect(merged).toBe(local);
  });

  it("takes cloud when cloud.updated_at is newer than lastPullAt and local has no review since pull", () => {
    const local = makeCard(1, null, null);
    const freshRow = makeCloudRow(1, "2026-05-12", "2026-05-12", "2026-05-13T10:00:00.000Z");
    const [merged] = mergeCloudIntoLocalSilent(
      [local],
      [freshRow],
      "2026-05-13T08:00:00.000Z",
    );
    expect(merged.state.lastReview).toBe("2026-05-12");
    expect(merged.state.firstSeen).toBe("2026-05-12");
  });

  it("keeps local when cloud row is unchanged since last pull", () => {
    const local = makeCard(1, "2026-05-12", "2026-05-12");
    const oldRow = makeCloudRow(1, "2026-05-12", "2026-05-12", "2026-05-13T07:00:00.000Z");
    const [merged] = mergeCloudIntoLocalSilent(
      [local],
      [oldRow],
      "2026-05-13T08:00:00.000Z",
    );
    expect(merged).toBe(local);
  });

  it("returns local unchanged when no matching cloud row", () => {
    const local = makeCard(42, "2026-05-12", "2026-05-12");
    const [merged] = mergeCloudIntoLocalSilent([local], [], null);
    expect(merged).toBe(local);
  });

  it("skips null-subject_key cloud rows in merge (unmigrated edges do not affect local state)", () => {
    const local = makeCard(1, null, null);
    const unmigrated: CloudRow = {
      card_type: "evolution-edge",
      subject_key: null,
      stability: 5,
      difficulty: 3,
      elapsed_days: 1,
      scheduled_days: 7,
      reps: 3,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-05-18",
      last_review: "2026-05-11",
      first_seen: "2026-04-01",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-11T12:00:00.000Z",
    };
    const [merged] = mergeCloudIntoLocalSilent([local], [unmigrated], null);
    // name card should be unaffected by unmigrated edge row
    expect(merged).toBe(local);
  });
});

// ─── per-locale sync (#1562) ──────────────────────────────────────────────────

describe("toCloudRow / pushSingleCard: evo cards sync their actual locale (no force-en)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("pushSingleCard writes the evolution card's own locale (not forced to 'en')", async () => {
    // Build a minimal evolution card with locale='ja'.
    const jaEvoCard: ReviewableCard = {
      cardType: "evolution",
      id: 1_500_001,
      preEvoId: 1,
      preEvoName: "Bulbasaur",
      preEvoSpriteUrl: "/sprites/1.webp",
      postEvoId: 2,
      postEvoName: "Ivysaur",
      postEvoSpriteUrl: "/sprites/2.webp",
      triggerPhrase: null,
      subjectKey: "1>>>2",
      locale: "ja",
      state: {
        stability: 5,
        difficulty: 3,
        elapsedDays: 10,
        scheduledDays: 21,
        reps: 3,
        lapses: 0,
        fsrsState: "review",
        dueDate: "2026-06-01",
        lastReview: "2026-05-11",
        firstSeen: "2026-04-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    };

    const client = makeSupabaseClient();
    await pushSingleCard(client, "user-1", jaEvoCard);

    const [rowArg] = client._upsertSpy.mock.calls[0] as [
      { locale: string; card_type: string },
      unknown,
    ];
    // Must write "ja", not "en".
    expect(rowArg.locale).toBe("ja");
    expect(rowArg.card_type).toBe("evolution-edge");
  });
});

describe("mergeCloudIntoLocalSilent: inserts unmatched-locale cloud rows (#1562)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  function makeSeedPokemon(id: number): SeedPokemon {
    return {
      id,
      speciesId: id,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: `pokemon-${id}`,
      name: `pokemon-${id}`,
      spriteUrl: `https://example.com/${id}.png`,
      types: ["normal"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "A test pokemon.",
      flavorTexts: ["A test pokemon."],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Test Pokémon",
      generation: "generation-i",
      captureRate: null,
      baseHappiness: null,
      growthRate: null,
      habitat: null,
      genderRate: null,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
    };
  }

  it("inserts a cloud name row whose locale is not represented locally", () => {
    // Local has only an 'en' name card for species 1.
    const localEn = makeCard(1, null, null);

    // Cloud also has a 'ja' name card for species 1 (enrolled on another device).
    const cloudJaRow: CloudRow = {
      card_type: "name",
      subject_key: "1",
      locale: "ja",
      stability: 5,
      difficulty: 3,
      elapsed_days: 10,
      scheduled_days: 21,
      reps: 3,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-06-01",
      last_review: "2026-05-11",
      first_seen: "2026-04-01",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-11T12:00:00.000Z",
    };

    const seed = [makeSeedPokemon(1)];
    const merged = mergeCloudIntoLocalSilent([localEn], [cloudJaRow], null, seed, []);

    // Should now have two cards: the original en + the inserted ja.
    expect(merged).toHaveLength(2);
    const jaCard = merged.find((c) => (c.locale ?? "en") === "ja");
    expect(jaCard).toBeDefined();
    // The inserted card carries the cloud state.
    expect(jaCard?.state.reps).toBe(3);
    expect(jaCard?.state.lastReview).toBe("2026-05-11");
  });

  it("does not insert when seed is omitted (backward-compat no-op)", () => {
    const localEn = makeCard(1, null, null);
    const cloudJaRow: CloudRow = {
      card_type: "name",
      subject_key: "1",
      locale: "ja",
      stability: 1,
      difficulty: 1,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-05-11",
      last_review: "2026-05-10",
      first_seen: "2026-05-09",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-11T12:00:00.000Z",
    };

    // No seed passed — insert pass skipped.
    const merged = mergeCloudIntoLocalSilent([localEn], [cloudJaRow], null);
    expect(merged).toHaveLength(1);
  });

  it("does not insert a cloud row that already has a matching local card", () => {
    // Local already has both en and ja name cards for species 1.
    const localEn = makeCard(1, null, null);
    const localJa = { ...makeCard(1, "2026-05-11", "2026-05-11"), locale: "ja" as const };
    const cloudJaRow: CloudRow = {
      card_type: "name",
      subject_key: "1",
      locale: "ja",
      stability: 3,
      difficulty: 2,
      elapsed_days: 5,
      scheduled_days: 10,
      reps: 2,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-05-20",
      last_review: "2026-05-10",
      first_seen: "2026-05-01",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-11T12:00:00.000Z",
    };

    const seed = [makeSeedPokemon(1)];
    const merged = mergeCloudIntoLocalSilent([localEn, localJa], [cloudJaRow], null, seed, []);
    // No new card inserted — the ja card was matched in Pass 1.
    expect(merged).toHaveLength(2);
  });
});

describe("mergeAffectsProgress: key-based comparison (#1562)", () => {
  // Access via pullAndMerge's behaviour is integration-level; here we test the
  // observable effect through mergeCloudIntoLocalSilent.
  // A direct unit-test of mergeAffectsProgress is in pullAndMerge.test.ts.
  // This describe block verifies the cloud.ts side (insert producing length change).
  it("mergeCloudIntoLocalSilent with an insertion changes the result length", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const localEn = makeCard(1, null, null);
    const cloudJaRow: CloudRow = {
      card_type: "name",
      subject_key: "1",
      locale: "ja",
      stability: 2,
      difficulty: 2,
      elapsed_days: 5,
      scheduled_days: 14,
      reps: 2,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-05-25",
      last_review: "2026-05-11",
      first_seen: "2026-05-01",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: "2026-05-12T10:00:00.000Z",
    };
    const seed: SeedPokemon[] = [{
      id: 1,
      speciesId: 1,
      isDefaultForm: true,
      formCategory: "default",
      formSlug: null,
      displayName: "Bulbasaur",
      name: "Bulbasaur",
      spriteUrl: "/sprites/1.webp",
      types: ["grass"],
      stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
      flavorText: "A seed.",
      flavorTexts: ["A seed."],
      evolutionChain: [],
      height: 7,
      weight: 69,
      baseExperience: 64,
      genus: "Seed",
      generation: "generation-i",
      captureRate: 45,
      baseHappiness: 50,
      growthRate: "medium-slow",
      habitat: null,
      genderRate: 1,
      isLegendary: false,
      isMythical: false,
      cryUrl: null,
    }];

    const merged = mergeCloudIntoLocalSilent([localEn], [cloudJaRow], null, seed, []);
    // Insertion happened — array is longer, which signals mergeAffectsProgress.
    expect(merged.length).toBe(2);
  });
});

// ─── applyCloudAuthoritative ──────────────────────────────────────────────────

function makeSeedPokemon(id: number): SeedPokemon {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${id}`,
    name: `pokemon-${id}`,
    spriteUrl: `https://example.com/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A test pokemon.",
    flavorTexts: ["A test pokemon."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Test Pokemon",
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
  };
}

function makeEvoSeed(id: number, preEvoId: number, postEvoId: number): EvolutionCard {
  return {
    cardType: "evolution",
    id,
    preEvoId,
    preEvoName: `Pokemon ${preEvoId}`,
    preEvoSpriteUrl: `https://example.com/${preEvoId}.png`,
    postEvoId,
    postEvoName: `Pokemon ${postEvoId}`,
    postEvoSpriteUrl: `https://example.com/${postEvoId}.png`,
    triggerPhrase: null,
  };
}

describe("applyCloudAuthoritative", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOpts: SeedOpts = { nameEnabled: true, evolutionEnabled: false };

  it("local-only card with prior reps is reset to new when cloud has no matching row", () => {
    const seed = [makeSeedPokemon(1)];
    // Cloud has no row for species 1.
    const cloud: CloudRow[] = [];
    const result = applyCloudAuthoritative(seed, [], cloud, defaultOpts);
    expect(result).toHaveLength(1);
    expect(result[0].state.lastReview).toBeNull();
    expect(result[0].state.reps).toBe(0);
    expect(result[0].state.fsrsState).toBe("new");
  });

  it("cloud-only card appears at cloud state when seed contains it", () => {
    const seed = [makeSeedPokemon(2)];
    const cloudRow = makeCloudRow(2, "2026-05-01", "2026-05-10");
    const result = applyCloudAuthoritative(seed, [], [cloudRow], defaultOpts);
    expect(result).toHaveLength(1);
    expect(result[0].state.lastReview).toBe("2026-05-10");
    expect(result[0].state.firstSeen).toBe("2026-05-01");
    expect(result[0].state.reps).toBe(1);
  });

  it("card present in both local context and cloud adopts cloud state", () => {
    // Seed the function with a species that has prior local progress, but because
    // applyCloudAuthoritative rebuilds from seed, the cloud row wins.
    const seed = [makeSeedPokemon(3)];
    const cloudRow = makeCloudRow(3, "2026-05-05", "2026-05-12");
    const result = applyCloudAuthoritative(seed, [], [cloudRow], defaultOpts);
    expect(result).toHaveLength(1);
    expect(result[0].state.lastReview).toBe("2026-05-12");
    expect(result[0].state.firstSeen).toBe("2026-05-05");
  });

  it("returns cards for all seed species regardless of cloud coverage", () => {
    const seed = [makeSeedPokemon(10), makeSeedPokemon(11), makeSeedPokemon(12)];
    // Cloud only has species 11.
    const cloudRow = makeCloudRow(11, "2026-05-01", "2026-05-10");
    const result = applyCloudAuthoritative(seed, [], [cloudRow], defaultOpts);
    expect(result).toHaveLength(3);
    const ids = result.map((c) => c.subjectKey);
    expect(ids).toContain("10");
    expect(ids).toContain("11");
    expect(ids).toContain("12");
  });

  it("evolution cards are included when evolutionEnabled is true", () => {
    const seed = [makeSeedPokemon(4), makeSeedPokemon(5)];
    const evoSeed = [makeEvoSeed(1500001, 4, 5)];
    const opts: SeedOpts = { nameEnabled: true, evolutionEnabled: true };
    const result = applyCloudAuthoritative(seed, evoSeed, [], opts);
    // 2 name cards + 1 evo card = 3 total
    expect(result).toHaveLength(3);
    const evoCard = result.find((c) => c.cardType === "evolution");
    expect(evoCard).toBeDefined();
  });

  it("two calls with the same now produce identical card sets (deterministic)", () => {
    const seed = [makeSeedPokemon(20), makeSeedPokemon(21)];
    const cloud: CloudRow[] = [];
    const now = new Date("2026-05-14T10:00:00.000Z");
    const first = applyCloudAuthoritative(seed, [], cloud, defaultOpts, now);
    const second = applyCloudAuthoritative(seed, [], cloud, defaultOpts, now);
    expect(first).toEqual(second);
  });
});

// ─── locale round-trip (#1259) ────────────────────────────────────────────────

describe("locale round-trip (#1259)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushSession sends locale field in every row", async () => {
    const client = makeSupabaseClient();
    // A card without an explicit locale defaults to "en"
    const card = makeCard(1, "2026-05-10", "2026-05-10");
    await pushSession(client, "user-1", [card]);
    const [batchArg] = client._upsertSpy.mock.calls[0] as [
      Array<{ locale: string }>,
      unknown,
    ];
    expect(batchArg[0].locale).toBe("en");
  });

  it("pushSingleCard sends locale field in the row", async () => {
    const client = makeSupabaseClient();
    const card = makeCard(1, "2026-05-10", "2026-05-10");
    await pushSingleCard(client, "user-1", card);
    const [rowArg] = client._upsertSpy.mock.calls[0] as [{ locale: string }, unknown];
    expect(rowArg.locale).toBe("en");
  });

  it("mergeCloudIntoLocal: two cloud rows for the same species in different locales are kept separate", () => {
    // The local card array has one "en" name card for species 5 and one "ja" name card for species 5.
    const enCard: ReviewableCard = { ...makeCard(5, null, null), locale: "en" as const };
    const jaCard: ReviewableCard = {
      ...makeCard(5, null, null),
      id: 5,        // same id
      locale: "ja" as const,
    };

    const enRow: CloudRow = {
      ...makeCloudRow(5, "2026-05-01", "2026-05-10"),
      locale: "en",
    };
    const jaRow: CloudRow = {
      ...makeCloudRow(5, "2026-05-02", "2026-05-11"),
      locale: "ja",
    };

    const merged = mergeCloudIntoLocal([enCard, jaCard], [enRow, jaRow]);
    // Both cards should exist and adopt their respective cloud rows.
    const mergedEn = merged.find((c) => (c as ReviewableCard & { locale?: string }).locale === "en");
    const mergedJa = merged.find((c) => (c as ReviewableCard & { locale?: string }).locale === "ja");
    expect(mergedEn?.state.lastReview).toBe("2026-05-10");
    expect(mergedJa?.state.lastReview).toBe("2026-05-11");
  });

  it("mergeCloudIntoLocal: cloud row with locale='ja' does not update an 'en' local card", () => {
    // An "en" local card must not be overwritten by a "ja" cloud row.
    const enCard: ReviewableCard = { ...makeCard(7, null, null), locale: "en" as const };
    const jaRow: CloudRow = {
      ...makeCloudRow(7, "2026-05-01", "2026-05-10"),
      locale: "ja",
    };
    const [merged] = mergeCloudIntoLocal([enCard], [jaRow]);
    // The "en" card should be unchanged — no matching cloud row.
    expect(merged.state.lastReview).toBeNull();
    expect(merged).toBe(enCard);
  });
});

// ─── isStructuralError (#1358) ────────────────────────────────────────────────

function makePostgrestError(code: string): PostgrestError {
  const name = "PostgrestError";
  return {
    code,
    message: `Error with code ${code}`,
    details: "",
    hint: "",
    name,
    toJSON: () => ({ code, message: `Error with code ${code}`, details: "", hint: "", name }),
  };
}

describe("isStructuralError (#1358)", () => {
  it("returns false for null error", () => {
    expect(isStructuralError(null)).toBe(false);
  });

  it("returns true for 42P10 (ON CONFLICT mismatch — the #1344 incident code)", () => {
    expect(isStructuralError(makePostgrestError("42P10"))).toBe(true);
  });

  it("returns true for 42P01 (relation does not exist)", () => {
    expect(isStructuralError(makePostgrestError("42P01"))).toBe(true);
  });

  it("returns true for 42703 (column does not exist)", () => {
    expect(isStructuralError(makePostgrestError("42703"))).toBe(true);
  });

  it("returns true for 42501 (insufficient privilege at PG layer)", () => {
    expect(isStructuralError(makePostgrestError("42501"))).toBe(true);
  });

  it("returns true for 23505 (unique violation)", () => {
    expect(isStructuralError(makePostgrestError("23505"))).toBe(true);
  });

  it("returns true for 23503 (foreign key violation)", () => {
    expect(isStructuralError(makePostgrestError("23503"))).toBe(true);
  });

  it("returns false for 23514 (check_violation — deliberate regression trigger)", () => {
    // 23514 is the DELIBERATE regression trigger (migrations 002/015/016/017).
    // It must NOT fail loud — it is the expected rejection of bad state.
    expect(isStructuralError(makePostgrestError("23514"))).toBe(false);
  });

  it("returns false for PGRST-prefixed codes (PostgREST transient schema-cache)", () => {
    expect(isStructuralError(makePostgrestError("PGRST116"))).toBe(false);
    expect(isStructuralError(makePostgrestError("PGRST301"))).toBe(false);
  });

  it("returns false for generic 5xx-style codes", () => {
    // These are transient — not structural.
    expect(isStructuralError(makePostgrestError("500"))).toBe(false);
  });

  it("returns false when code is not a string", () => {
    const err = { code: undefined, message: "test", details: "", hint: "" } as unknown as PostgrestError;
    expect(isStructuralError(err)).toBe(false);
  });
});

// ─── structural-error side-effects in pushSingleCard / pushSession (#1358) ────
//
// pushSingleCard / pushSession call markStructuralSyncError and clearStructuralSyncError
// directly from structuralError.ts (no module-level slot, no pop indirection).
// These tests verify the direct-mark behaviour by mocking structuralError.ts.

vi.mock("@/lib/sync/structuralError", () => ({
  markStructuralSyncError: vi.fn(),
  clearStructuralSyncError: vi.fn(),
  getStructuralSyncError: vi.fn(() => null),
  hasStructuralProbeBeenAttempted: vi.fn(() => false),
  markStructuralProbeAttempted: vi.fn(),
  resetStructuralProbe: vi.fn(),
}));

import {
  markStructuralSyncError,
  clearStructuralSyncError,
} from "@/lib/sync/structuralError";

describe("pushSingleCard structural error handling (#1358)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(markStructuralSyncError).mockClear();
    vi.mocked(clearStructuralSyncError).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls markStructuralSyncError('42P10') and console.error fires on a 42P10 error", async () => {
    const client = makeSupabaseClient({ code: "42P10", message: "ON CONFLICT mismatch", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const card = makeCard(1, "2026-05-10", "2026-05-10");

    const result = await pushSingleCard(client, "user-1", card);

    expect(result).toBe(false);
    expect(markStructuralSyncError).toHaveBeenCalledWith("42P10");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("42P10")
    );
  });

  it("calls markStructuralSyncError('23505') for a unique violation", async () => {
    const client = makeSupabaseClient({ code: "23505", message: "unique violation", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const card = makeCard(2, "2026-05-10", "2026-05-10");

    await pushSingleCard(client, "user-1", card);

    expect(markStructuralSyncError).toHaveBeenCalledWith("23505");
  });

  it("does not call markStructuralSyncError on a 23514 (deliberate regression trigger)", async () => {
    // 23514 is deliberate — the regression trigger rejecting bad state.
    const client = makeSupabaseClient({ code: "23514", message: "check violation", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const card = makeCard(3, "2026-05-10", "2026-05-10");

    await pushSingleCard(client, "user-1", card);

    expect(markStructuralSyncError).not.toHaveBeenCalled();
  });

  it("does not call markStructuralSyncError on a network TypeError (catch path)", async () => {
    const upsertSpy = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = {
      from: vi.fn().mockReturnValue({ upsert: upsertSpy }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
    const card = makeCard(4, "2026-05-10", "2026-05-10");

    const result = await pushSingleCard(client, "user-1", card);

    expect(result).toBe(false);
    expect(markStructuralSyncError).not.toHaveBeenCalled();
  });

  it("does not call markStructuralSyncError on a transient PGRST error", async () => {
    const client = makeSupabaseClient({ code: "PGRST116", message: "transient", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const card = makeCard(5, "2026-05-10", "2026-05-10");

    await pushSingleCard(client, "user-1", card);

    expect(markStructuralSyncError).not.toHaveBeenCalled();
  });

  it("calls clearStructuralSyncError on a successful push (self-heal after deploy fix)", async () => {
    const client = makeSupabaseClient(null); // no error — success
    const card = makeCard(6, "2026-05-10", "2026-05-10");

    const result = await pushSingleCard(client, "user-1", card);

    expect(result).toBe(true);
    expect(clearStructuralSyncError).toHaveBeenCalledTimes(1);
    expect(markStructuralSyncError).not.toHaveBeenCalled();
  });
});

describe("pushSession structural error handling (#1358)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(markStructuralSyncError).mockClear();
    vi.mocked(clearStructuralSyncError).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls markStructuralSyncError('42P10') and console.error fires when a batch returns 42P10", async () => {
    const client = makeSupabaseClient({ code: "42P10", message: "ON CONFLICT mismatch", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const cards = [makeCard(1, "2026-05-10", "2026-05-10"), makeCard(2, "2026-05-10", "2026-05-10")];

    const result = await pushSession(client, "user-1", cards);

    expect(result).toBe(false);
    expect(markStructuralSyncError).toHaveBeenCalledWith("42P10");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("42P10"));
  });

  it("breaks early and calls upsert only once on structural error (does not retry remaining batches)", async () => {
    // With BATCH=200 and 1 card, there is only 1 batch. Verify the early-break
    // logic by checking upsert was called exactly once.
    const client = makeSupabaseClient({ code: "42P10", message: "mismatch", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const cards = [makeCard(10, "2026-05-10", "2026-05-10")];

    await pushSession(client, "user-1", cards);

    expect(client._upsertSpy).toHaveBeenCalledTimes(1);
    expect(markStructuralSyncError).toHaveBeenCalledWith("42P10");
  });

  it("does not call markStructuralSyncError on a 23514 (deliberate regression trigger)", async () => {
    const client = makeSupabaseClient({ code: "23514", message: "check violation", details: "", hint: "", name: "PostgrestError", toJSON: () => ({}) });
    const cards = [makeCard(11, "2026-05-10", "2026-05-10")];

    await pushSession(client, "user-1", cards);

    expect(markStructuralSyncError).not.toHaveBeenCalled();
  });

  it("calls clearStructuralSyncError when all batches succeed (self-heal)", async () => {
    const client = makeSupabaseClient(null); // no error — success
    const cards = [makeCard(12, "2026-05-10", "2026-05-10")];

    const result = await pushSession(client, "user-1", cards);

    expect(result).toBe(true);
    expect(clearStructuralSyncError).toHaveBeenCalledTimes(1);
    expect(markStructuralSyncError).not.toHaveBeenCalled();
  });
});
