import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isSyncSafe,
  pushSession,
  pushSingleCard,
  mergeCloudIntoLocal,
} from "./cloud";
import type { ReviewableCard } from "@/lib/review/session";
import type { CloudRow } from "./cloud";

// Minimal ReviewableCard factory for sync tests.
// Only the fields relevant to isSyncSafe and sync are set.
function makeCard(
  id: number,
  firstSeen: string | null,
  lastReview: string | null
): ReviewableCard {
  return {
    id,
    cardType: "name",
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
    },
  } as ReviewableCard;
}

function makeCloudRow(
  pokemonId: number,
  firstSeen: string | null,
  lastReview: string | null,
  updatedAt = "2026-05-11T12:00:00.000Z"
): CloudRow {
  return {
    pokemon_id: pokemonId,
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
    const [batchArg] = client._upsertSpy.mock.calls[0] as [Array<{ pokemon_id: number }>, unknown];
    expect(batchArg.map((r) => r.pokemon_id)).toEqual([1]);
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

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("5"));
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
});
