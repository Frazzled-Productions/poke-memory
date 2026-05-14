/**
 * Integration test: Row Level Security on card_reviews.
 *
 * Verifies the four RLS policies that every table in this project carries:
 *   SELECT — user sees only their own rows.
 *   INSERT  — user cannot insert a row with another user's user_id.
 *   UPDATE  — user cannot update another user's rows.
 *   DELETE  — not exercised here (same predicate pattern).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestBranch, teardownTestBranch, type TestBranch } from "./setup";
import { applyMigrations } from "./applyMigrations";
import { createTestUser, deleteTestUser, type TestUser } from "./auth";
import { pushSession } from "../cloud";
import type { ReviewableCard } from "@/lib/review/session";

let branch: TestBranch;
let userA: TestUser;
let userB: TestUser;
let branchUrl: string;
let anonKey: string;

beforeAll(async () => {
  branch = await setupTestBranch();
  await applyMigrations(branch.branchRef);
  branchUrl = branch.branchUrl;
  anonKey = branch.anonKey;

  userA = await createTestUser(branch.serviceClient, branchUrl, anonKey);
  userB = await createTestUser(branch.serviceClient, branchUrl, anonKey);
}, 120_000);

afterAll(async () => {
  if (userA) await deleteTestUser(branch.serviceClient, userA.id);
  if (userB) await deleteTestUser(branch.serviceClient, userB.id);
  if (branch) await teardownTestBranch(branch);
});

function makeCard(subjectKey: string): ReviewableCard {
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
    spriteUrl: "",
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
      stability: 1.0,
      difficulty: 5.0,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      fsrsState: "review",
      dueDate: "2026-06-01",
      lastReview: "2026-05-30",
      firstSeen: "2026-05-28",
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  } as ReviewableCard;
}

describe("RLS policies (integration)", () => {
  it("user A cannot SELECT user B's rows", async () => {
    // Seed a row for user B.
    await pushSession(userB.client, userB.id, [makeCard("200")]);

    // Pull as user A — should get zero rows, not see user B's row.
    const { data, error } = await userA.client
      .from("card_reviews")
      .select("subject_key")
      .eq("user_id", userB.id);

    expect(error).toBeNull();
    // RLS returns an empty set, not an error, when the policy filters rows.
    expect(data).toHaveLength(0);
  });

  it("user A's INSERT with user_id=B is rejected by RLS", async () => {
    const { error } = await userA.client.from("card_reviews").insert({
      user_id: userB.id, // deliberately wrong user_id
      card_type: "name",
      subject_key: "201",
      stability: 1.0,
      difficulty: 5.0,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2026-06-01",
      last_review: "2026-05-30",
      first_seen: "2026-05-28",
      seen_in_pasture: false,
      updated_at: new Date().toISOString(),
    });

    // PostgREST returns an HTTP 403 or a Postgres RLS error.
    expect(error).not.toBeNull();
  });

  it("user A cannot UPDATE user B's rows", async () => {
    // Ensure user B has a row at subject_key="202".
    await pushSession(userB.client, userB.id, [makeCard("202")]);

    // Try to update that row as user A.
    const { error } = await userA.client
      .from("card_reviews")
      .update({ reps: 99 })
      .eq("user_id", userB.id)
      .eq("card_type", "name")
      .eq("subject_key", "202");

    // Either error is returned, or RLS silently matches zero rows.
    // Either way, the row must not have been modified.
    const { data } = await userB.client
      .from("card_reviews")
      .select("reps")
      .eq("user_id", userB.id)
      .eq("card_type", "name")
      .eq("subject_key", "202");
    // The row must exist (not just undefined) and retain the seeded reps=1.
    // Without this positive assertion, data?.[0] === undefined would make
    // the .not.toBe(99) check above pass vacuously on a silent RLS zero-row match.
    expect(data).toHaveLength(1);
    expect(data?.[0]?.reps).toBe(1);
  });

  it("user A can read their own rows and not user B's", async () => {
    await pushSession(userA.client, userA.id, [makeCard("301")]);
    await pushSession(userB.client, userB.id, [makeCard("302")]);

    const { data, error } = await userA.client
      .from("card_reviews")
      .select("subject_key");

    expect(error).toBeNull();
    const keys = (data ?? []).map((r: { subject_key: string }) => r.subject_key);
    expect(keys).toContain("301");
    expect(keys).not.toContain("302");
  });
});
