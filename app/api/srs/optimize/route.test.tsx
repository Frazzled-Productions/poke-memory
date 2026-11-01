/**
 * Tests for POST /api/srs/optimize
 *
 * Verifies that `persistWeights` calls `.rpc("merge_user_settings", ...)` with
 * the expected arguments, and that every fit is gated by the per-IP bucket and
 * the server-side `claim_optimizer_slot` RPC. The RPCs' SQL is proved against
 * real Postgres in lib/sync/integration/optimizer-slot.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks - factories must not reference outer variables (hoisting rule).
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@open-spaced-repetition/binding", () => {
  // Use regular function expressions so they can be called with `new`.
  function FSRSBindingItemMock(this: Record<string, unknown>, reviews: unknown) {
    this.reviews = reviews;
  }
  function FSRSBindingReviewMock(this: Record<string, unknown>, rating: unknown, deltaT: unknown) {
    this.rating = rating;
    this.deltaT = deltaT;
  }
  return {
    FSRSBindingItem: vi.fn().mockImplementation(function (this: Record<string, unknown>, reviews: unknown) { FSRSBindingItemMock.call(this, reviews); }),
    FSRSBindingReview: vi.fn().mockImplementation(function (this: Record<string, unknown>, rating: unknown, deltaT: unknown) { FSRSBindingReviewMock.call(this, rating, deltaT); }),
    computeParameters: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks so that vi.mock hoisting takes effect.
// ---------------------------------------------------------------------------
import { POST } from "./route";
import { hashIp } from "@/lib/auth/rateLimitIp";
import { createClient } from "@/lib/supabase/server";
import { computeParameters } from "@open-spaced-repetition/binding";

const CLIENT_IP = "203.0.113.7";
const FAKE_WEIGHTS = [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 1.0, 1.96, 0.11, 0.29, 2.29, 2.31, 0.23];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Grade-log rows that exceed MIN_REVIEWS_FOR_OPTIMIZATION (200) */
function makeLargeGradeLog(count = 210) {
  return Array.from({ length: count }, (_, i) => ({
    occurred_at: Date.UTC(2026, 0, 1) + i * 86_400_000,
    entry_date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    card_type: "name",
    grade: 4,
    subject_key: String((i % 10) + 1), // ten distinct cards - subjectKey required to count
  }));
}

/** A POST as the route sees it on Vercel: the first forwarded address is the client's. */
function makeRequest() {
  return new Request("https://pokememory.test/api/srs/optimize", {
    method: "POST",
    headers: { "x-forwarded-for": CLIENT_IP + ", 10.0.0.1" },
  });
}

function makeSupabaseMock(overrides: {
  gradeLogData?: unknown;
  gradeLogError?: unknown;
  rpcError?: unknown;
  /** claim_optimizer_slot's result: 0 claims, above 0 is the ms left. */
  claimRetryAfterMs?: number;
  claimError?: unknown;
  ipAllowed?: boolean;
  ipError?: unknown;
  user?: { id: string } | null;
} = {}) {
  const rpcMock = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<unknown>>(async (name) => {
    if (name === "check_rate_limit") {
      return { data: overrides.ipAllowed ?? true, error: overrides.ipError ?? null };
    }
    if (name === "claim_optimizer_slot") {
      return { data: overrides.claimRetryAfterMs ?? 0, error: overrides.claimError ?? null };
    }
    return { error: overrides.rpcError ?? null };
  });

  // The grade_log query chains: select → eq → order → range(from, to)
  // fetchAllPages calls .range(from, to) as the terminal method.
  // Return data with length < pageSize (1000) so fetchAllPages stops after one call.
  const gradeLogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({
      data: overrides.gradeLogData ?? makeLargeGradeLog(),
      error: overrides.gradeLogError ?? null,
    }),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "grade_log") return gradeLogChain;
    throw new Error(`Unexpected table: ${table}`);
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: overrides.user !== undefined ? overrides.user : { id: "user-abc-123" } },
        error: overrides.user === null ? new Error("no session") : null,
      }),
    },
    from: fromMock,
    rpc: rpcMock,
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { client, rpcMock, fromMock };
}

/** Names of the RPCs the route called, in order. */
function rpcNames(rpcMock: { mock: { calls: unknown[][] } }): string[] {
  return rpcMock.mock.calls.map(([name]) => name as string);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/srs/optimize - persistWeights via RPC", () => {
  const USER_ID = "user-abc-123";

  beforeEach(() => {
    vi.clearAllMocks();
    (computeParameters as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_WEIGHTS);
  });

  it("calls rpc('merge_user_settings') with p_user_id and a p_patch containing fsrsWeights and fsrsWeightsOptimizedAt", async () => {
    const { rpcMock } = makeSupabaseMock();

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weights).toEqual(FAKE_WEIGHTS);
    expect(body.optimizedAt).toBeTruthy();

    // The IP bucket, then the slot, then the final persist.
    expect(rpcNames(rpcMock)).toEqual([
      "check_rate_limit",
      "claim_optimizer_slot",
      "merge_user_settings",
    ]);
    const [, args] = rpcMock.mock.calls[2];
    expect(args!.p_user_id).toBe(USER_ID);
    expect(args!.p_patch).toEqual({
      fsrsWeights: FAKE_WEIGHTS,
      fsrsWeightsOptimizedAt: body.optimizedAt,
    });
  });

  it("returns 500 with save_failed when rpc returns an error", async () => {
    makeSupabaseMock({ rpcError: new Error("db error") });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("save_failed");
  });

  it("returns 422 with degenerate_data, reviewCount, and detail when computeParameters throws", async () => {
    makeSupabaseMock();
    (computeParameters as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("not enough data for optimization"),
    );

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("degenerate_data");
    expect(typeof body.reviewCount).toBe("number");
    expect(body.detail).toBe("not enough data for optimization");
  });

  it("returns 422 with detail='internal_error' when computeParameters throws a non-Error value", async () => {
    makeSupabaseMock();
    (computeParameters as ReturnType<typeof vi.fn>).mockRejectedValue(42);

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("degenerate_data");
    expect(body.detail).toBe("internal_error");
  });

  it("returns 500 with error='unknown' and a detail string when postHandler throws unexpectedly", async () => {
    // Simulate an unhandled throw from createClient itself (bypasses all inner
    // try/catches), which should be caught by the outer POST wrapper.
    const { createClient: mockCreateClient } = await import("@/lib/supabase/server");
    (mockCreateClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("unexpected panic"),
    );

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("unknown");
    expect(body.detail).toBe("unexpected panic");
  });

  it("returns 500 with detail='internal_error' when unhandled throw has no message", async () => {
    const { createClient: mockCreateClient } = await import("@/lib/supabase/server");
    (mockCreateClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(null);

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("unknown");
    expect(body.detail).toBe("internal_error");
  });

  it("returns 503 with reviews_unavailable when grade log fetch returns null", async () => {
    makeSupabaseMock({ gradeLogError: new Error("connection refused") });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("reviews_unavailable");
  });

  it("returns 401 when the user is not authenticated", async () => {
    const { rpcMock } = makeSupabaseMock({ user: null });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the slot is refused, and does not fit", async () => {
    const { rpcMock } = makeSupabaseMock({ claimRetryAfterMs: 90_500 });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: "cooldown", retryAfterMs: 90_500 });
    expect(response.headers.get("Retry-After")).toBe("91");
    expect(computeParameters).not.toHaveBeenCalled();
    expect(rpcNames(rpcMock)).not.toContain("merge_user_settings");
  });

  it("returns 503 and does not fit when the slot cannot be claimed", async () => {
    makeSupabaseMock({ claimError: new Error("db down") });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("service_unavailable");
    expect(computeParameters).not.toHaveBeenCalled();
  });

  it("returns 422 without claiming when the grade log has too few reviews", async () => {
    const { rpcMock } = makeSupabaseMock({ gradeLogData: makeLargeGradeLog(5) });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("not_enough_reviews");
    expect(rpcNames(rpcMock)).toEqual(["check_rate_limit"]);
  });

  it("returns 503 without claiming when the grade log cannot be read", async () => {
    const { rpcMock } = makeSupabaseMock({ gradeLogError: new Error("connection refused") });

    const response = await POST(makeRequest());

    expect(response.status).toBe(503);
    expect(rpcNames(rpcMock)).toEqual(["check_rate_limit"]);
  });

  it("does not read user_settings to decide whether to run", async () => {
    const { rpcMock, fromMock } = makeSupabaseMock();

    await POST(makeRequest());

    expect(fromMock.mock.calls.map(([t]: [string]) => t)).toEqual(["grade_log"]);
    // Nothing is stamped into settings before the fit.
    expect(rpcNames(rpcMock).filter((n) => n === "merge_user_settings")).toHaveLength(1);
  });

  it("returns 429 before reading anything when the IP bucket is full", async () => {
    const { rpcMock, fromMock } = makeSupabaseMock({ ipAllowed: false });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfterMs).toBe(60 * 60 * 1000);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcNames(rpcMock)).toEqual(["check_rate_limit"]);
  });

  it("sends the hashed first forwarded address, never the raw one", async () => {
    const { rpcMock } = makeSupabaseMock();

    await POST(makeRequest());

    const [, args] = rpcMock.mock.calls[0];
    expect(args).toEqual({ p_ip_hash: hashIp(CLIENT_IP), p_action: "optimize" });
    expect(JSON.stringify(args)).not.toContain(CLIENT_IP);
  });

  it("carries on when the IP check errors, because the slot still holds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rpcMock } = makeSupabaseMock({ ipError: new Error("rpc missing") });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(rpcNames(rpcMock)).toContain("claim_optimizer_slot");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
