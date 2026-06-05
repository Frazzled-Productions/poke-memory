/**
 * Tests for POST /api/sync
 *
 * Verifies auth rejection, malformed/oversized request handling, partial-payload
 * behaviour, and the upsert path. The route does not call revalidateTag - it is
 * a write-only beacon endpoint with no cache-invalidation side effects, and these
 * tests confirm that absence.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks - hoisted so vi.mock runs before imports.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import { CARD_REVIEWS_CONFLICT_COLS } from "@/lib/sync/cloud";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Build a synthetic Request with a JSON body. */
function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a synthetic Request with a raw (non-JSON) body. */
function makeRawRequest(body: string): Request {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
}

function makeSupabaseMock(overrides: {
  user?: { id: string } | null;
} = {}) {
  const upsertMock = vi.fn().mockResolvedValue({ error: null });

  const fromMock = vi.fn(() => ({
    upsert: upsertMock,
  }));

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: overrides.user !== undefined ? overrides.user : { id: "user-xyz-789" } },
        error: overrides.user === null ? new Error("no session") : null,
      }),
    },
    from: fromMock,
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { client, fromMock, upsertMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Auth rejection
  // -------------------------------------------------------------------------

  it("returns 401 when the user is not authenticated", async () => {
    makeSupabaseMock({ user: null });

    const res = await POST(makeRequest({ cards: [makeCard()] }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unauthorized");
  });

  it("does not attempt an upsert when unauthenticated", async () => {
    const { upsertMock } = makeSupabaseMock({ user: null });

    await POST(makeRequest({ cards: [makeCard()] }));

    expect(upsertMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Malformed / invalid request body
  // -------------------------------------------------------------------------

  it("returns 400 for non-JSON body", async () => {
    const res = await POST(makeRawRequest("not-json{{"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_json");
  });

  it("returns 400 when cards field is missing from payload", async () => {
    // The route validates the payload before touching Supabase - no mock needed.
    const res = await POST(makeRequest({ notCards: [] }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_payload");
  });

  it("returns 400 when cards is not an array", async () => {
    const res = await POST(makeRequest({ cards: "not-an-array" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_payload");
  });

  it("returns 400 when cards is null", async () => {
    const res = await POST(makeRequest({ cards: null }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_payload");
  });

  // -------------------------------------------------------------------------
  // Partial-payload / edge-case behaviour
  // -------------------------------------------------------------------------

  it("returns 200 with ok:true when cards array is empty (no upsert needed)", async () => {
    const { upsertMock } = makeSupabaseMock();

    const res = await POST(makeRequest({ cards: [] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // No DB call should be made for an empty payload.
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("omits seen_in_pasture from the upsert row when the field is null on the card", async () => {
    const { upsertMock } = makeSupabaseMock();

    const card = makeCard({ seen_in_pasture: null });
    await POST(makeRequest({ cards: [card] }));

    const [upsertRows] = upsertMock.mock.calls[0];
    expect(upsertRows[0]).not.toHaveProperty("seen_in_pasture");
  });

  it("includes seen_in_pasture in the upsert row when the field is present", async () => {
    const { upsertMock } = makeSupabaseMock();

    const card = makeCard({ seen_in_pasture: true });
    await POST(makeRequest({ cards: [card] }));

    const [upsertRows] = upsertMock.mock.calls[0];
    expect(upsertRows[0].seen_in_pasture).toBe(true);
  });

  it("coalesces hidden_since to null when absent from the card", async () => {
    const { upsertMock } = makeSupabaseMock();

    // Omit hidden_since entirely to simulate an old-client payload.
    const { hidden_since: _omit, ...cardWithoutHiddenSince } = makeCard() as {
      hidden_since: unknown;
      [key: string]: unknown;
    };

    await POST(makeRequest({ cards: [cardWithoutHiddenSince] }));

    const [upsertRows] = upsertMock.mock.calls[0];
    expect(upsertRows[0].hidden_since).toBeNull();
  });

  it("injects user_id and updated_at into each upserted row", async () => {
    const { upsertMock } = makeSupabaseMock({ user: { id: "user-xyz-789" } });

    await POST(makeRequest({ cards: [makeCard()] }));

    const [upsertRows] = upsertMock.mock.calls[0];
    expect(upsertRows[0].user_id).toBe("user-xyz-789");
    expect(typeof upsertRows[0].updated_at).toBe("string");
  });

  it("upserts into card_reviews with the correct onConflict columns", async () => {
    const { upsertMock, fromMock } = makeSupabaseMock();

    await POST(makeRequest({ cards: [makeCard()] }));

    // The route must target the card_reviews table.
    expect(fromMock).toHaveBeenCalledWith("card_reviews");
    // The composite conflict key must match the DB unique constraint (migration 029 adds locale).
    expect(upsertMock).toHaveBeenCalledWith(
      expect.any(Array),
      { onConflict: CARD_REVIEWS_CONFLICT_COLS },
    );
  });

  // -------------------------------------------------------------------------
  // Batching behaviour (oversized payload)
  // -------------------------------------------------------------------------

  it("splits a payload larger than 200 cards into multiple upsert batches", async () => {
    const { upsertMock } = makeSupabaseMock();

    // 201 cards - should trigger two batches: 200 + 1.
    const cards = Array.from({ length: 201 }, (_, i) =>
      makeCard({ subject_key: String(i + 1) })
    );

    const res = await POST(makeRequest({ cards }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(2);

    const [firstBatch] = upsertMock.mock.calls[0];
    const [secondBatch] = upsertMock.mock.calls[1];
    expect(firstBatch).toHaveLength(200);
    expect(secondBatch).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Upsert failure / partial failure
  // -------------------------------------------------------------------------

  it("returns 502 when all upsert attempts fail for a batch", async () => {
    // Make every upsert attempt return an error so all BATCH_RETRIES exhaust.
    const { fromMock } = makeSupabaseMock();
    const upsertMock = vi.fn().mockResolvedValue({ error: new Error("db error") });
    fromMock.mockReturnValue({ upsert: upsertMock });

    // Use fake timers to avoid the 100 ms retry delay in tests.
    vi.useFakeTimers();
    const postPromise = POST(makeRequest({ cards: [makeCard()] }));
    await vi.runAllTimersAsync();
    const res = await postPromise;
    vi.useRealTimers();

    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("partial_failure");
  });

  it("returns 200 when upsert eventually succeeds after a transient failure", async () => {
    const { fromMock } = makeSupabaseMock();
    // First attempt fails, second succeeds.
    const upsertMock = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error("transient") })
      .mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ upsert: upsertMock });

    vi.useFakeTimers();
    const postPromise = POST(makeRequest({ cards: [makeCard()] }));
    await vi.runAllTimersAsync();
    const res = await postPromise;
    vi.useRealTimers();

    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // Confirm the route retried - upsert was called more than once.
    expect(upsertMock.mock.calls.length).toBeGreaterThan(1);
  });

  // -------------------------------------------------------------------------
  // No cache-invalidation side effects
  // -------------------------------------------------------------------------

  it("does not invoke revalidateTag - the sync route is write-only with no cache side effects", async () => {
    // Regression guard: if someone adds a revalidateTag call to the sync
    // route, this assertion fails and forces an explicit decision.
    makeSupabaseMock();

    const res = await POST(makeRequest({ cards: [makeCard()] }));

    expect(res.status).toBe(200);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });
});
