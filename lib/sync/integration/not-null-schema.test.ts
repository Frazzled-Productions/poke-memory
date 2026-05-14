/**
 * Integration test: NOT NULL constraints on card_reviews.
 *
 * Attempts to INSERT rows that are missing required columns and asserts the
 * DB rejects them.  This is the class of bug that #444 / PR #453 introduced
 * (pokemon_id NOT NULL violated by the new push code).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestBranch, teardownTestBranch, type TestBranch } from "./setup";
import { applyMigrations } from "./applyMigrations";
import { createTestUser, deleteTestUser, type TestUser } from "./auth";

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

/** Minimal valid row for card_reviews after all migrations. */
function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: user.id,
    card_type: "name",
    subject_key: "999",
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
    ...overrides,
  };
}

describe("NOT NULL schema constraints (integration)", () => {
  it("rejects INSERT missing card_type", async () => {
    const row = validRow({ card_type: undefined, subject_key: "900" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/null|not.null|violates/i);
  });

  it("rejects INSERT missing subject_key", async () => {
    const row = validRow({ subject_key: undefined, card_type: "name" });
    // Insert via service client so RLS is bypassed and we see the schema error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/null|not.null|violates/i);
  });

  it("rejects INSERT missing user_id", async () => {
    const row = validRow({ user_id: undefined, subject_key: "901" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/null|not.null|violates/i);
  });

  it("rejects INSERT missing stability (NOT NULL after migration 004)", async () => {
    const row = validRow({ stability: undefined, subject_key: "902" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.message ?? error?.code).toMatch(/null|not.null|violates/i);
  });

  it("rejects INSERT with invalid fsrs_state", async () => {
    const row = validRow({ fsrs_state: "invalid-state", subject_key: "903" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    // Postgres CHECK constraint violation
    expect(error?.message ?? error?.code).toMatch(/check|constraint|violates/i);
  });

  it("accepts a fully valid INSERT", async () => {
    const row = validRow({ subject_key: "998" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).toBeNull();
  });
});

describe("stability / difficulty CHECK constraints (integration)", () => {
  it("rejects INSERT with difficulty < 0", async () => {
    const row = validRow({ difficulty: -1, subject_key: "910" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514"); // check_violation
  });

  it("rejects INSERT with difficulty > 10", async () => {
    const row = validRow({ difficulty: 11, subject_key: "911" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("rejects INSERT with stability < 0", async () => {
    const row = validRow({ stability: -0.1, subject_key: "912" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
  });

  it("accepts INSERT with difficulty = 0 (new-card sentinel)", async () => {
    const row = validRow({ difficulty: 0, stability: 0, subject_key: "913" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).toBeNull();
  });

  it("accepts INSERT with difficulty = 10 (upper bound)", async () => {
    const row = validRow({ difficulty: 10, subject_key: "914" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await branch.serviceClient.from("card_reviews").insert(row as any);
    expect(error).toBeNull();
  });
});
