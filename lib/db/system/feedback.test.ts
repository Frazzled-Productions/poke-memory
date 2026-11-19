/**
 * Feedback and rate-limit system queries against the D1 test database:
 * retention (034), the digest read (042), Discord post ids (051) and
 * check_rate_limit / the bucket purge (041, 045).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forUser } from "../scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "../testing/sqliteD1";
import {
  deleteFeedbackCreatedBefore,
  discordPostStore,
  discordPostsForUser,
  feedbackForDigest,
  feedbackRetentionCutoff,
  insertFeedback,
} from "./feedback";
import { checkRateLimit } from "../rateLimit";
import { deleteExpiredRateLimitBuckets } from "./rateLimit";

let d1: SqliteD1;
let alice: string;
let bob: string;

beforeEach(() => {
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
});
afterEach(() => d1.close());

const base = { category: "bug" as const, message: "it broke", page: "/", app_version: "1.0.0" };

async function feedbackAt(userId: string | null, createdAt: string, category = "bug") {
  // forUser for a signed-in row (created_at is writable there); guests go through insertFeedback.
  if (userId === null) {
    const { id } = await insertFeedback(d1, { ...base, user_id: null });
    await d1.prepare("UPDATE feedback SET created_at = ?, category = ? WHERE id = ?").bind(createdAt, category, id).run();
    return id;
  }
  const [row] = await forUser(d1, userId).insert(
    "feedback",
    { ...base, category, created_at: createdAt },
    { returning: ["id"] },
  );
  return row.id as string;
}

describe("insertFeedback", () => {
  it("inserts guest and signed-in rows and returns the id and database timestamp", async () => {
    const guest = await insertFeedback(d1, { ...base, user_id: null });
    const signedIn = await insertFeedback(d1, { ...base, user_id: alice, page: null, app_version: null });
    expect(guest.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(guest.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const rows = await forUser(d1, alice).select("feedback");
    expect(rows).toEqual([expect.objectContaining({ id: signedIn.id, user_id: alice, page: null })]);
  });

  it("refuses an unknown category (the CHECK constraint)", async () => {
    await expect(
      insertFeedback(d1, { ...base, user_id: null, category: "spam" as "bug" }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("feedback retention (034)", () => {
  it("cuts off at 12 calendar months", () => {
    expect(feedbackRetentionCutoff(new Date("2026-11-19T03:00:00.000Z")).toISOString()).toBe("2025-11-19T03:00:00.000Z");
  });

  it("deletes only rows created before the cutoff and returns their ids and categories", async () => {
    const old = await feedbackAt(alice, "2025-11-19T02:59:59.999Z");
    const oldGuest = await feedbackAt(null, "2025-01-01T00:00:00.000Z", "feature");
    const kept = await feedbackAt(bob, "2025-11-19T03:00:00.000Z");
    const deleted = await deleteFeedbackCreatedBefore(d1, new Date("2025-11-19T03:00:00.000Z"));
    expect(deleted.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: old, category: "bug" },
        { id: oldGuest, category: "feature" },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect((await forUser(d1, bob).select("feedback")).map((r) => r.id)).toEqual([kept]);
  });
});

describe("feedbackForDigest (042)", () => {
  it("returns rows in the window with authenticated set from user_id, never user_id itself", async () => {
    await feedbackAt(alice, "2026-11-18T00:00:00.000Z", "bug");
    await feedbackAt(null, "2026-11-17T00:00:00.000Z", "feature");
    await feedbackAt(bob, "2026-11-01T00:00:00.000Z", "other");
    const rows = await feedbackForDigest(d1, new Date("2026-11-12T09:00:00.000Z"));
    expect(rows.map(({ category, authenticated }) => ({ category, authenticated })).sort((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: "bug", authenticated: true },
      { category: "feature", authenticated: false },
    ]);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["authenticated", "category", "id"]);
  });
});

describe("discordPostStore and discordPostsForUser (051)", () => {
  it("stores, reads and forgets a message id, and reads the feedback message", async () => {
    const store = discordPostStore(d1);
    const { id } = await insertFeedback(d1, { ...base, user_id: alice });
    expect(await store.feedbackMessage(id)).toBe("it broke");
    expect(await store.feedbackExists(id)).toBe(true);
    expect(await store.messageIdFor(id)).toBeNull();
    await store.storeMessageId(id, "123456789");
    expect(await store.messageIdFor(id)).toBe("123456789");
    await store.forgetMessageId(id);
    expect(await store.messageIdFor(id)).toBeNull();
    expect(await store.feedbackMessage("missing")).toBeNull();
    expect(await store.feedbackExists("missing")).toBe(false);
  });

  it("keeps the stored id after the feedback row goes (no foreign key)", async () => {
    const store = discordPostStore(d1);
    const id = await feedbackAt(alice, "2020-01-01T00:00:00.000Z");
    await store.storeMessageId(id, "m-1");
    await deleteFeedbackCreatedBefore(d1, new Date("2021-01-01T00:00:00.000Z"));
    expect(await store.feedbackExists(id)).toBe(false);
    expect(await store.messageIdFor(id)).toBe("m-1");
  });

  it("lists one user's posts only", async () => {
    const store = discordPostStore(d1);
    const a = await insertFeedback(d1, { ...base, user_id: alice });
    const b = await insertFeedback(d1, { ...base, user_id: bob });
    await store.storeMessageId(a.id, "m-a");
    await store.storeMessageId(b.id, "m-b");
    expect(await discordPostsForUser(d1, alice)).toEqual([{ feedback_id: a.id, discord_message_id: "m-a" }]);
  });
});

describe("checkRateLimit (041, 045)", () => {
  const ip = "a".repeat(64);
  const other = "b".repeat(64);
  const t0 = new Date("2026-11-19T12:00:00.000Z");
  const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  it("allows 5 feedback attempts in 10 minutes and refuses the 6th, recording nothing for it", async () => {
    for (let i = 0; i < 5; i++) expect(await checkRateLimit(d1, ip, "feedback", at(i))).toBe(true);
    expect(await checkRateLimit(d1, ip, "feedback", at(5))).toBe(false);
    // Another IP and another action are counted separately.
    expect(await checkRateLimit(d1, other, "feedback", at(5))).toBe(true);
    expect(await checkRateLimit(d1, ip, "signin", at(5))).toBe(true);
    // Ten minutes after the first attempt, it has left the short window.
    expect(await checkRateLimit(d1, ip, "feedback", at(10.5))).toBe(true);
  });

  it("caps feedback at 20 in an hour", async () => {
    for (let i = 0; i < 20; i++) expect(await checkRateLimit(d1, ip, "feedback", at(i * 2.5))).toBe(true);
    expect(await checkRateLimit(d1, ip, "feedback", at(51))).toBe(false);
    expect(await checkRateLimit(d1, ip, "feedback", at(61))).toBe(true);
  });

  it("uses the sign-up (5) and sign-in (10) caps", async () => {
    for (let i = 0; i < 5; i++) expect(await checkRateLimit(d1, ip, "signup", t0)).toBe(true);
    expect(await checkRateLimit(d1, ip, "signup", t0)).toBe(false);
    for (let i = 0; i < 10; i++) expect(await checkRateLimit(d1, ip, "signin", t0)).toBe(true);
    expect(await checkRateLimit(d1, ip, "signin", t0)).toBe(false);
  });

  it("the clean-up deletes attempts older than two hours", async () => {
    await checkRateLimit(d1, ip, "feedback", at(-121));
    await checkRateLimit(d1, ip, "feedback", at(-119));
    expect(await deleteExpiredRateLimitBuckets(d1, t0)).toBe(1);
    expect(await deleteExpiredRateLimitBuckets(d1, t0)).toBe(0);
  });
});
