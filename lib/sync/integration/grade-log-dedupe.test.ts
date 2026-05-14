/**
 * Integration test: grade_log deduplication via (user_id, occurred_at) unique constraint.
 *
 * Verifies that inserting two grade_log entries with the same (user_id, occurred_at)
 * pair — via pushGradeLog with ignoreDuplicates: true — silently drops the second
 * without error, rather than throwing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestBranch, teardownTestBranch, type TestBranch } from "./setup";
import { applyMigrations } from "./applyMigrations";
import { createTestUser, deleteTestUser, type TestUser } from "./auth";
import { pushGradeLog, pullGradeLog } from "../gradeLog";
import type { GradeLogEntry } from "@/lib/gradelog/persistence";

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

function makeEntry(
  occurredAt: number,
  overrides: Partial<GradeLogEntry> = {},
): GradeLogEntry {
  return {
    occurredAt,
    date: "2026-05-14",
    cardType: "name",
    grade: 4,
    subjectKey: "1",
    ...overrides,
  };
}

describe("grade_log deduplication (integration)", () => {
  it("inserts the same occurred_at twice without error — second is dropped", async () => {
    const ts = 1_747_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const first = makeEntry(ts, { grade: 4, subjectKey: "10" });
    const second = makeEntry(ts, { grade: 1, subjectKey: "10" }); // same timestamp, different grade

    // Both pushes should return true (ignoreDuplicates suppresses the conflict).
    const ok1 = await pushGradeLog(user.client, user.id, [first]);
    expect(ok1).toBe(true);

    const ok2 = await pushGradeLog(user.client, user.id, [second]);
    expect(ok2).toBe(true);

    // Pull back — should have exactly one row for this timestamp.
    const rows = await pullGradeLog(user.client, user.id);
    expect(rows).not.toBeNull();

    const matching = rows!.filter((r) => r.occurredAt === ts);
    expect(matching).toHaveLength(1);

    // The first insert's grade should have been preserved (second was dropped).
    expect(matching[0].grade).toBe(4);
  });

  it("inserts two entries with different occurred_at — both survive", async () => {
    const base = 1_747_100_000_000 + Math.floor(Math.random() * 1_000_000);
    const entries = [makeEntry(base, { subjectKey: "20" }), makeEntry(base + 1, { subjectKey: "21" })];

    const ok = await pushGradeLog(user.client, user.id, entries);
    expect(ok).toBe(true);

    const rows = await pullGradeLog(user.client, user.id);
    const ts1 = rows?.find((r) => r.occurredAt === base);
    const ts2 = rows?.find((r) => r.occurredAt === base + 1);
    expect(ts1).toBeDefined();
    expect(ts2).toBeDefined();
  });

  it("push of empty array returns true and writes nothing", async () => {
    const before = (await pullGradeLog(user.client, user.id))?.length ?? 0;
    const ok = await pushGradeLog(user.client, user.id, []);
    expect(ok).toBe(true);
    const after = (await pullGradeLog(user.client, user.id))?.length ?? 0;
    expect(after).toBe(before);
  });
});
