import { describe, it, expect, vi, beforeEach } from "vitest";
import { pullPushSubscriptionCount } from "./pushSubscriptions";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Minimal Supabase client mock factory
// ---------------------------------------------------------------------------

type MockQueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
};

function makeMockClient(result: { count: number | null; error: unknown }) {
  const builder: MockQueryBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
  };

  // eq() is the final call and resolves the promise.
  builder.eq.mockResolvedValue(result);
  // select() returns the builder so .eq() can be chained.
  builder.select.mockReturnValue(builder);

  const client = {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient;

  return { client, builder };
}

const FAKE_USER_ID = "user-abc-123";

describe("pullPushSubscriptionCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── happy path: populated ───────────────────────────────────────────────

  it("returns the count returned by the DB on the happy path", async () => {
    const { client } = makeMockClient({ count: 3, error: null });

    const result = await pullPushSubscriptionCount(client, FAKE_USER_ID);

    expect(result).toBe(3);
  });

  // ─── happy path: zero count ───────────────────────────────────────────────

  it("returns 0 when the authenticated user has no subscription rows", async () => {
    const { client } = makeMockClient({ count: 0, error: null });

    const result = await pullPushSubscriptionCount(client, FAKE_USER_ID);

    expect(result).toBe(0);
  });

  it("returns 0 when count is null but error is null (Supabase returns null count for empty set)", async () => {
    const { client } = makeMockClient({ count: null, error: null });

    const result = await pullPushSubscriptionCount(client, FAKE_USER_ID);

    expect(result).toBe(0);
  });

  // ─── error path: Supabase error ──────────────────────────────────────────

  it("returns null when Supabase returns an error object", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = makeMockClient({ count: null, error: { message: "DB error", code: "PGRST" } });

    const result = await pullPushSubscriptionCount(client, FAKE_USER_ID);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // ─── error path: thrown exception ────────────────────────────────────────

  it("returns null when the Supabase call throws (network error)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
    };
    builder.eq.mockRejectedValue(new Error("network error"));
    builder.select.mockReturnValue(builder);
    const client = {
      from: vi.fn().mockReturnValue(builder),
    } as unknown as SupabaseClient;

    const result = await pullPushSubscriptionCount(client, FAKE_USER_ID);

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // ─── RLS: query is filtered by userId ────────────────────────────────────

  it("queries the push_subscriptions table filtered by the provided userId (RLS)", async () => {
    const { client, builder } = makeMockClient({ count: 2, error: null });

    await pullPushSubscriptionCount(client, FAKE_USER_ID);

    // Verify the table name.
    expect(client.from).toHaveBeenCalledWith("push_subscriptions");
    // Verify the count query shape.
    expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    // Verify userId filter - RLS ensures each caller only sees their own rows.
    expect(builder.eq).toHaveBeenCalledWith("user_id", FAKE_USER_ID);
  });

  it("uses the caller-supplied userId, not a hard-coded constant", async () => {
    const { client, builder } = makeMockClient({ count: 1, error: null });
    const differentUserId = "user-xyz-999";

    await pullPushSubscriptionCount(client, differentUserId);

    expect(builder.eq).toHaveBeenCalledWith("user_id", differentUserId);
  });
});
