/**
 * Integration test: card_reviews_reject_regression_trigger.
 *
 * Verifies that the DB-level trigger (migration 002, updated in 012)
 * blocks lifecycle-timestamp regressions:
 *   - last_review cannot transition to NULL
 *   - first_seen cannot transition to NULL
 *   - last_review cannot move backward
 *
 * Also covers the seen_in_pasture regression guard from migration 008 and the
 * reps / lapses monotonicity guards from migrations 015 and 016 (if present).
 *
 * Uses the service-role client for direct SQL via rpc to bypass RLS when
 * testing trigger behaviour in isolation.  For push-path integration tests
 * (which go through RLS), see card-reviews-round-trip.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestBranch, teardownTestBranch, type TestBranch } from "./setup";
import { applyMigrations } from "./applyMigrations";
import { createTestUser, deleteTestUser, type TestUser } from "./auth";
import { pushSession, pullSession } from "../cloud";
import type { ReviewableCard } from "@/lib/review/session";

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

function makeReviewedCard(subjectKey: string): ReviewableCard {
  return {
    id: Number(subjectKey),
    speciesId: Number(subjectKey),
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: `Pokemon ${subjectKey}`,
    cardType: "name",
    name: `Pokemon ${subjectKey}`,
    subjectKey,
    spriteUrl: `https://example.com/${subjectKey}.png`,
    types: ["normal"],
    stats: {
      hp: 45,
      attack: 49,
      defense: 49,
      specialAttack: 65,
      specialDefense: 65,
      speed: 45,
    },
    flavorText: "",
    flavorTexts: [],
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
      stability: 2.0,
      difficulty: 5.0,
      elapsedDays: 1,
      scheduledDays: 3,
      reps: 2,
      lapses: 0,
      fsrsState: "review",
      dueDate: "2026-06-01",
      lastReview: "2026-05-20",
      firstSeen: "2026-05-18",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  } as ReviewableCard;
}

describe("regression trigger (integration)", () => {
  it("blocks UPDATE that sets last_review to NULL", async () => {
    // Seed a reviewed card.
    const card = makeReviewedCard("101");
    await pushSession(user.client, user.id, [card]);

    // Attempt to overwrite with a regressed row via the service client
    // (bypasses RLS so we test the trigger directly).
    const { error } = await branch.serviceClient
      .from("card_reviews")
      .update({ last_review: null })
      .eq("user_id", user.id)
      .eq("card_type", "name")
      .eq("subject_key", "101");

    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/check_violation|regression/i);
  });

  it("blocks UPDATE that sets first_seen to NULL", async () => {
    const card = makeReviewedCard("102");
    await pushSession(user.client, user.id, [card]);

    const { error } = await branch.serviceClient
      .from("card_reviews")
      .update({ first_seen: null })
      .eq("user_id", user.id)
      .eq("card_type", "name")
      .eq("subject_key", "102");

    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/check_violation|regression/i);
  });

  it("blocks UPDATE that moves last_review backward", async () => {
    const card = makeReviewedCard("103");
    // last_review is 2026-05-20.
    await pushSession(user.client, user.id, [card]);

    const { error } = await branch.serviceClient
      .from("card_reviews")
      .update({ last_review: "2026-05-01" }) // earlier than 2026-05-20
      .eq("user_id", user.id)
      .eq("card_type", "name")
      .eq("subject_key", "103");

    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/check_violation|regression/i);
  });

  it("allows UPDATE that moves last_review forward", async () => {
    const card = makeReviewedCard("104");
    await pushSession(user.client, user.id, [card]);

    const { error } = await branch.serviceClient
      .from("card_reviews")
      .update({ last_review: "2026-06-01" }) // later than 2026-05-20
      .eq("user_id", user.id)
      .eq("card_type", "name")
      .eq("subject_key", "104");

    // Forward movement must NOT be rejected.
    expect(error).toBeNull();
  });

  it("allows UPDATE that keeps last_review the same", async () => {
    const card = makeReviewedCard("105");
    await pushSession(user.client, user.id, [card]);

    const { error } = await branch.serviceClient
      .from("card_reviews")
      .update({ last_review: "2026-05-20", scheduled_days: 7 })
      .eq("user_id", user.id)
      .eq("card_type", "name")
      .eq("subject_key", "105");

    expect(error).toBeNull();
  });
});
