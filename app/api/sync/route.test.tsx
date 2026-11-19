/**
 * Tests for POST /api/sync on D1 (design D4): auth rejection, malformed
 * request handling, partial payloads, batching, retries and structural
 * errors, against the D1 test database through forUser. The service worker's
 * Background Sync replay (app/sw.ts) posts the same { cards } body, so the
 * request and response shapes are pinned here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const { getCloudflareContext, requireAuth } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { POST } from "./route";
import { revalidateTag } from "next/cache";
import { forUser } from "@/lib/db/scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1, type SpiedD1, type SpyHooks } from "@/lib/db/testing/spyD1";

let d1: SqliteD1;
let db: SpiedD1;
let alice: string;
let bob: string;
let sessionUser: string | null;

function useDb(hooks: SpyHooks = {}) {
  db = spyD1(d1, hooks);
  getCloudflareContext.mockResolvedValue({ env: { DB: db }, ctx: { waitUntil: vi.fn() } });
}

beforeEach(() => {
  vi.clearAllMocks();
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  sessionUser = alice;
  useDb();
  requireAuth.mockImplementation(async (_request: Request, options: { withOkField?: boolean } = {}) =>
    sessionUser
      ? { user: { id: sessionUser } }
      : NextResponse.json(options.withOkField ? { ok: false, error: "unauthorized" } : { error: "unauthorized" }, { status: 401 }),
  );
});
afterEach(() => d1.close());

/** Minimal valid CloudRow for use in request bodies. */
function makeCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    card_type: "name",
    subject_key: "1",
    stability: 1.5,
    difficulty: 5.0,
    elapsed_days: 1,
    scheduled_days: 3,
    reps: 1,
    lapses: 0,
    fsrs_state: "review",
    due_date: "2026-05-20",
    last_review: "2026-05-17",
    first_seen: "2026-05-17",
    hidden_since: null,
    seen_in_pasture: false,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
}

const cardsOf = (userId: string) =>
  forUser(d1, userId).select("card_reviews", { order: [{ column: "subject_key" }, { column: "locale" }] });
const cardWrites = () => db.calls.filter((c) => c.table === "card_reviews");

/** Runs POST with fake timers so the 100 ms retry delays pass at once. */
async function postWithTimers(body: unknown) {
  vi.useFakeTimers();
  try {
    const pending = POST(makeRequest(body));
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

describe("POST /api/sync", () => {
  it("returns 401 when the user is not authenticated, and writes nothing", async () => {
    sessionUser = null;
    const res = await POST(makeRequest({ cards: [makeCard()] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(requireAuth).toHaveBeenCalledWith(expect.any(Request), { withOkField: true });
    expect(db.calls).toEqual([]);
  });

  it("returns 400 for a non-JSON body", async () => {
    const res = await POST(makeRawRequest("not-json{{"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_json" });
  });

  it.each([[{ notCards: [] }], [{ cards: "not-an-array" }], [{ cards: null }]])(
    "returns 400 invalid_payload for %j",
    async (body) => {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "invalid_payload" });
    },
  );

  it("returns 200 with ok:true for an empty cards array, touching no table", async () => {
    const res = await POST(makeRequest({ cards: [] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.calls).toEqual([]);
  });

  it("writes the card for the session user, with the database's updated_at", async () => {
    const res = await POST(makeRequest({ cards: [makeCard({ updated_at: "1999-01-01T00:00:00.000Z" })] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await cardsOf(alice);
    expect(row).toMatchObject({
      user_id: alice,
      card_type: "name",
      subject_key: "1",
      locale: "en",
      stability: 1.5,
      reps: 1,
      due_date: "2026-05-20",
      last_review: "2026-05-17",
      seen_in_pasture: false,
      hidden_since: null,
    });
    // updated_at is never taken from the client (migration 043, F22 / #1856).
    expect(row.updated_at).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("keeps the stored seen_in_pasture when the card sends null, and writes it when present", async () => {
    await POST(makeRequest({ cards: [makeCard({ seen_in_pasture: true })] }));
    expect((await cardsOf(alice))[0].seen_in_pasture).toBe(true);
    // A later card without the field must not trip the one-way guard (017).
    const res = await POST(makeRequest({ cards: [makeCard({ seen_in_pasture: null, reps: 2 })] }));
    expect(res.status).toBe(200);
    expect((await cardsOf(alice))[0]).toMatchObject({ seen_in_pasture: true, reps: 2 });
  });

  it("coalesces a missing hidden_since to null and a missing locale to en", async () => {
    await POST(makeRequest({ cards: [makeCard({ hidden_since: "2026-05-01" })] }));
    const { hidden_since: _h, ...oldClientCard } = makeCard({ reps: 2 });
    await POST(makeRequest({ cards: [oldClientCard] }));
    expect((await cardsOf(alice))[0]).toMatchObject({ hidden_since: null, locale: "en" });
  });

  it("upserts on (user_id, card_type, subject_key, locale): a resend updates, a new locale inserts", async () => {
    await POST(makeRequest({ cards: [makeCard()] }));
    await POST(makeRequest({ cards: [makeCard({ reps: 2 }), makeCard({ locale: "ja" })] }));
    const rows = await cardsOf(alice);
    expect(rows.map((r) => [r.locale, r.reps])).toEqual([
      ["en", 2],
      ["ja", 1],
    ]);
  });

  it("splits a payload larger than 200 cards into two batches", async () => {
    const cards = Array.from({ length: 201 }, (_, i) => makeCard({ subject_key: String(i + 1) }));
    const res = await POST(makeRequest({ cards }));
    expect(res.status).toBe(200);
    expect(await cardsOf(alice)).toHaveLength(201);
    expect([...new Set(cardWrites().map((c) => c.batchSize))]).toEqual([200, 1]);
  });

  it("falls back to per-row upserts on a 23514 so one stale row does not block the rest", async () => {
    await POST(makeRequest({ cards: [makeCard({ subject_key: "1", reps: 5 })] }));
    const res = await POST(
      makeRequest({ cards: [makeCard({ subject_key: "1", reps: 2 }), makeCard({ subject_key: "2" })] }),
    );
    expect(res.status).toBe(200);
    const rows = await cardsOf(alice);
    expect(rows.map((r) => [r.subject_key, r.reps])).toEqual([
      ["1", 5],
      ["2", 1],
    ]);
  });

  it("returns 502 partial_failure when every attempt fails, after three tries", async () => {
    useDb({
      before: ({ table }) => {
        if (table === "card_reviews") throw new Error("D1_ERROR: network connection lost");
      },
    });
    const res = await postWithTimers({ cards: [makeCard()] });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "partial_failure" });
    expect(cardWrites()).toHaveLength(3);
  });

  it("returns 200 when the upsert succeeds after a transient failure", async () => {
    let failures = 1;
    useDb({
      before: ({ table }) => {
        if (table === "card_reviews" && failures-- > 0) throw new Error("D1_ERROR: transient");
      },
    });
    const res = await postWithTimers({ cards: [makeCard()] });
    expect(res.status).toBe(200);
    expect(cardWrites().length).toBeGreaterThan(1);
    expect(await cardsOf(alice)).toHaveLength(1);
  });

  it("returns 409 at once for a structural error, without retrying", async () => {
    useDb({
      before: ({ table }) => {
        if (table === "card_reviews") throw new Error("D1_ERROR: table card_reviews has no column named x");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeRequest({ cards: [makeCard()] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "structural_error", code: "42703" });
    expect(cardWrites()).toHaveLength(1);
  });

  it("does not invoke revalidateTag - the sync route is write-only with no cache side effects", async () => {
    const res = await POST(makeRequest({ cards: [makeCard()] }));
    expect(res.status).toBe(200);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  describe("two users", () => {
    it("user B's sync never writes or changes user A's cards, even naming A's id", async () => {
      await POST(makeRequest({ cards: [makeCard({ reps: 3 })] }));
      sessionUser = bob;
      const res = await POST(makeRequest({ cards: [makeCard({ reps: 1, user_id: alice })] }));
      // user_id in the body is ignored: the session user is pinned.
      expect(res.status).toBe(200);
      expect((await cardsOf(alice)).map((r) => r.reps)).toEqual([3]);
      expect((await cardsOf(bob)).map((r) => [r.user_id, r.reps])).toEqual([[bob, 1]]);
    });

    it("the same card key for two users is two rows", async () => {
      await POST(makeRequest({ cards: [makeCard()] }));
      sessionUser = bob;
      await POST(makeRequest({ cards: [makeCard({ reps: 4 })] }));
      expect((await cardsOf(alice))[0].reps).toBe(1);
      expect((await cardsOf(bob))[0].reps).toBe(4);
    });
  });
});
