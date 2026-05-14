/**
 * Integration test: card-reviews push → pull round-trip.
 *
 * Verifies that the data written by pushSession() is byte-for-byte
 * retrievable by pullSession() through the real Supabase REST layer,
 * including schema constraints and defaults (auto-updated_at).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestBranch, teardownTestBranch, type TestBranch } from "./setup";
import { applyMigrations } from "./applyMigrations";
import { createTestUser, deleteTestUser, type TestUser } from "./auth";
import { pushSession, pullSession } from "../cloud";
import type { ReviewableCard } from "@/lib/review/session";

// ---------------------------------------------------------------------------
// Shared branch — created once per file, torn down in afterAll.
// ---------------------------------------------------------------------------
let branch: TestBranch;
let user: TestUser;

beforeAll(async () => {
  branch = await setupTestBranch();
  await applyMigrations(branch.branchRef);
  user = await createTestUser(branch.serviceClient, branch.branchUrl, branch.anonKey);
}, 120_000);

afterAll(async () => {
  if (user) await deleteTestUser(branch.serviceClient, user.id);
  if (branch) await teardownTestBranch(branch);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCard(overrides: Partial<ReviewableCard> = {}): ReviewableCard {
  return {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
    cardType: "name",
    name: "Bulbasaur",
    subjectKey: "1",
    spriteUrl: "https://example.com/1.png",
    types: ["grass", "poison"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
    flavorText: "A seed is planted.",
    flavorTexts: ["A seed is planted."],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
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
      stability: 2.5,
      difficulty: 5.0,
      elapsedDays: 1,
      scheduledDays: 3,
      reps: 2,
      lapses: 0,
      fsrsState: "review",
      dueDate: "2026-06-01",
      lastReview: "2026-05-29",
      firstSeen: "2026-05-27",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
    ...overrides,
  } as ReviewableCard;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("card-reviews round-trip (integration)", () => {
  it("pushSession then pullSession returns the same FSRS fields", async () => {
    const card = makeCard({ subjectKey: "1-rt" });
    const ok = await pushSession(user.client, user.id, [card]);
    expect(ok).toBe(true);

    const rows = await pullSession(user.client, user.id);
    expect(rows).not.toBeNull();

    const row = rows?.find((r) => r.subject_key === "1-rt");
    expect(row).toBeDefined();
    expect(row!.card_type).toBe("name");
    expect(row!.subject_key).toBe("1-rt");
    expect(row!.stability).toBe(card.state.stability);
    expect(row!.difficulty).toBe(card.state.difficulty);
    expect(row!.scheduled_days).toBe(card.state.scheduledDays);
    expect(row!.reps).toBe(card.state.reps);
    expect(row!.lapses).toBe(card.state.lapses);
    expect(row!.fsrs_state).toBe(card.state.fsrsState);
    expect(row!.due_date).toBe(card.state.dueDate);
    expect(row!.last_review).toBe(card.state.lastReview);
    expect(row!.first_seen).toBe(card.state.firstSeen);
    expect(row!.seen_in_pasture).toBe(false);
    expect(row!.hidden_since).toBeNull();
    // updated_at should be set by the DB trigger / default.
    expect(typeof row!.updated_at).toBe("string");
  });

  it("upserts update in place without creating duplicate rows", async () => {
    const card = makeCard({
      subjectKey: "25",
      state: {
        stability: 1.0,
        difficulty: 4.0,
        elapsedDays: 0,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        fsrsState: "review",
        dueDate: "2026-06-02",
        lastReview: "2026-05-30",
        firstSeen: "2026-05-28",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    } as Partial<ReviewableCard>);

    // Push once, then push again with updated reps.
    await pushSession(user.client, user.id, [card]);
    const updated = {
      ...card,
      state: { ...card.state, reps: 3, scheduledDays: 7 },
    } as ReviewableCard;
    await pushSession(user.client, user.id, [updated]);

    const rows = await pullSession(user.client, user.id);
    const row = rows?.find((r) => r.subject_key === "25");
    expect(row).toBeDefined();
    expect(row!.reps).toBe(3);
    expect(row!.scheduled_days).toBe(7);

    // Still only one row for this card.
    const duplicates = rows?.filter((r) => r.subject_key === "25");
    expect(duplicates).toHaveLength(1);
  });

  it("round-trips seen_in_pasture=true and hidden_since", async () => {
    const card = makeCard({
      subjectKey: "4",
      state: {
        stability: 3.0,
        difficulty: 5.0,
        elapsedDays: 2,
        scheduledDays: 5,
        reps: 3,
        lapses: 1,
        fsrsState: "review",
        dueDate: "2026-06-05",
        lastReview: "2026-05-31",
        firstSeen: "2026-05-28",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: "2026-05-30",
        seenInPasture: true,
      },
    } as Partial<ReviewableCard>);

    await pushSession(user.client, user.id, [card]);
    const rows = await pullSession(user.client, user.id);
    const row = rows?.find((r) => r.subject_key === "4");
    expect(row?.seen_in_pasture).toBe(true);
    expect(row?.hidden_since).toBe("2026-05-30");
  });

  it("skips cards where firstSeen is set but lastReview is null (in-step)", async () => {
    const inStepCard = makeCard({
      subjectKey: "7",
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "learning",
        dueDate: "2026-05-14",
        lastReview: null,
        firstSeen: "2026-05-14", // in-step: firstSeen set but lastReview null
        learningStep: 0,
        stepStartedAt: Date.now(),
        hiddenSince: null,
        seenInPasture: false,
      },
    } as Partial<ReviewableCard>);

    // push should succeed (true) but silently skip the in-step card.
    const ok = await pushSession(user.client, user.id, [inStepCard]);
    expect(ok).toBe(true);

    const rows = await pullSession(user.client, user.id);
    const row = rows?.find((r) => r.subject_key === "7");
    // Should not have been written.
    expect(row).toBeUndefined();
  });
});
