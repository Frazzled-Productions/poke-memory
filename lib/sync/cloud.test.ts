import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isSyncSafe,
  pushSession,
  pushSingleCard,
  mergeCloudIntoLocal,
  mergeCloudIntoLocalSilent,
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
    state: {
      repetitions: 0,
      interval: 1,
      easeFactor: 2.5,
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
    repetitions: 1,
    interval: 1,
    ease_factor: 2.5,
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

  it("normalizes a bad cloud row by clearing firstSeen and resetting SM-2 fields", () => {
    const localCard = makeCard(5, null, null);
    const badRow = makeCloudRow(5, "2026-05-10", null);

    const [merged] = mergeCloudIntoLocal([localCard], [badRow]);

    expect(merged.state.firstSeen).toBeNull();
    expect(merged.state.lastReview).toBeNull();
    expect(merged.state.repetitions).toBe(0);
    expect(merged.state.interval).toBe(0);
    expect(merged.state.easeFactor).toBe(2.5);
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
    expect(merged.state.repetitions).toBe(1);
    expect(merged.state.interval).toBe(1);
    expect(merged.state.easeFactor).toBe(2.5);
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

// ─── mergeCloudIntoLocalSilent ────────────────────────────────────────────────

describe("mergeCloudIntoLocalSilent", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("branch 1: lastPullAt null — cloud wins unconditionally (first pull)", () => {
    const local = makeCard(1, null, null);
    const row = makeCloudRow(1, "2026-05-09", "2026-05-10");

    const [merged] = mergeCloudIntoLocalSilent([local], [row], null);

    expect(merged.state.firstSeen).toBe("2026-05-09");
    expect(merged.state.lastReview).toBe("2026-05-10");
  });

  it("branch 1: lastPullAt null — cloud wins even for a card with local lastReview", () => {
    const local = makeCard(2, "2026-04-01", "2026-04-01");
    const row = makeCloudRow(2, "2026-05-09", "2026-05-10");

    const [merged] = mergeCloudIntoLocalSilent([local], [row], null);

    expect(merged.state.lastReview).toBe("2026-05-10");
  });

  it("branch 2: local lastReview === pullDate — keep local (same calendar day)", () => {
    const pullAt = "2026-05-10T12:00:00.000Z";
    const local = makeCard(3, "2026-05-01", "2026-05-10"); // reviewed on pull day
    const row = makeCloudRow(3, "2026-05-09", "2026-05-09", "2026-05-10T14:00:00.000Z");

    const [merged] = mergeCloudIntoLocalSilent([local], [row], pullAt);

    expect(merged).toBe(local); // identity — no copy made
  });

  it("branch 2: local lastReview after pullDate — keep local", () => {
    const pullAt = "2026-05-09T12:00:00.000Z";
    const local = makeCard(4, "2026-05-10", "2026-05-10"); // reviewed after pull
    const row = makeCloudRow(4, "2026-05-08", "2026-05-08", "2026-05-09T10:00:00.000Z");

    const [merged] = mergeCloudIntoLocalSilent([local], [row], pullAt);

    expect(merged).toBe(local);
  });

  it("branch 3: cloud row updated_at > lastPullAt — take cloud", () => {
    const pullAt = "2026-05-09T12:00:00.000Z";
    const local = makeCard(5, null, null); // never reviewed locally
    const row = makeCloudRow(5, "2026-05-10", "2026-05-10", "2026-05-10T08:00:00.000Z"); // cloud newer

    const [merged] = mergeCloudIntoLocalSilent([local], [row], pullAt);

    expect(merged.state.lastReview).toBe("2026-05-10");
    expect(merged.state.firstSeen).toBe("2026-05-10");
  });

  it("branch 3 (updated_at absent): keep local — cannot confirm cloud is newer", () => {
    const pullAt = "2026-05-09T12:00:00.000Z";
    const local = makeCard(6, "2026-05-01", "2026-05-01");
    // Legacy row with no updated_at
    const row: import("./cloud").CloudRow = {
      pokemon_id: 6,
      repetitions: 5,
      interval: 10,
      ease_factor: 2.8,
      due_date: "2026-05-20",
      last_review: "2026-05-08",
      first_seen: "2026-05-01",
      updated_at: undefined,
    };

    const [merged] = mergeCloudIntoLocalSilent([local], [row], pullAt);

    expect(merged).toBe(local); // kept local
  });

  it("branch 4: cloud row updated_at <= lastPullAt — keep local (unchanged cloud)", () => {
    const pullAt = "2026-05-10T12:00:00.000Z";
    const local = makeCard(7, "2026-05-01", "2026-05-01");
    const row = makeCloudRow(7, "2026-05-09", "2026-05-09", "2026-05-10T10:00:00.000Z"); // same day, earlier

    const [merged] = mergeCloudIntoLocalSilent([local], [row], pullAt);

    expect(merged).toBe(local);
  });

  it("returns card unchanged when no matching cloud row", () => {
    const pullAt = "2026-05-09T12:00:00.000Z";
    const local = makeCard(99, "2026-05-01", "2026-05-01");

    const [merged] = mergeCloudIntoLocalSilent([local], [], pullAt);

    expect(merged).toBe(local);
  });
});
