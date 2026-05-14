/**
 * Tests for POST /api/srs/optimize
 *
 * Verifies that `persistWeights` calls `.rpc("merge_user_settings", ...)` with
 * the expected arguments instead of the former read-merge-write pattern.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — factories must not reference outer variables (hoisting rule).
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
import { createClient } from "@/lib/supabase/server";
import { computeParameters } from "@open-spaced-repetition/binding";
import { OPTIMIZER_COOLDOWN_MS } from "@/lib/srs/optimizer";

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
    card_id: (i % 10) + 1, // ten distinct cards — cardId required to count
  }));
}

function makeSupabaseMock(overrides: {
  settingsData?: unknown;
  settingsError?: unknown;
  gradeLogData?: unknown;
  gradeLogError?: unknown;
  rpcError?: unknown;
  user?: { id: string } | null;
} = {}) {
  const rpcMock = vi.fn().mockResolvedValue({ error: overrides.rpcError ?? null });

  const settingsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: overrides.settingsData ?? null,
      error: overrides.settingsError ?? null,
    }),
  };

  const gradeLogChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: overrides.gradeLogData ?? makeLargeGradeLog(),
      error: overrides.gradeLogError ?? null,
    }),
  };

  const fromMock = vi.fn((table: string) => {
    if (table === "user_settings") return settingsChain;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/srs/optimize — persistWeights via RPC", () => {
  const USER_ID = "user-abc-123";

  beforeEach(() => {
    vi.clearAllMocks();
    (computeParameters as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_WEIGHTS);
  });

  it("calls rpc('merge_user_settings') with p_user_id and a p_patch containing fsrsWeights and fsrsWeightsOptimizedAt", async () => {
    const { rpcMock } = makeSupabaseMock();

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weights).toEqual(FAKE_WEIGHTS);
    expect(body.optimizedAt).toBeTruthy();

    expect(rpcMock).toHaveBeenCalledOnce();
    const [fnName, args] = rpcMock.mock.calls[0];
    expect(fnName).toBe("merge_user_settings");
    expect(args.p_user_id).toBe(USER_ID);
    expect(args.p_patch).toMatchObject({
      fsrsWeights: FAKE_WEIGHTS,
      fsrsWeightsOptimizedAt: body.optimizedAt,
    });
  });

  it("returns 500 when rpc returns an error", async () => {
    makeSupabaseMock({ rpcError: new Error("db error") });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("optimization_failed");
  });

  it("returns 401 when the user is not authenticated", async () => {
    const { rpcMock } = makeSupabaseMock({ user: null });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("unauthorized");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 429 when within cooldown window", async () => {
    const recentlyOptimized = new Date(Date.now() - 1000).toISOString();
    const { rpcMock } = makeSupabaseMock({
      settingsData: {
        settings: { fsrsWeightsOptimizedAt: recentlyOptimized },
      },
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("cooldown");
    expect(body.retryAfterMs).toBeLessThanOrEqual(OPTIMIZER_COOLDOWN_MS);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 422 when grade log has fewer than MIN_REVIEWS_FOR_OPTIMIZATION entries with a cardId", async () => {
    const { rpcMock } = makeSupabaseMock({ gradeLogData: makeLargeGradeLog(5) });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("not_enough_reviews");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not call the old update/insert write path on user_settings table", async () => {
    const { rpcMock, fromMock } = makeSupabaseMock();

    await POST();

    // Confirm the only user_settings access is the cooldown SELECT.
    const userSettingsCalls = fromMock.mock.calls.filter(([t]: [string]) => t === "user_settings");
    expect(userSettingsCalls).toHaveLength(1);
    // The write is exclusively via rpc.
    expect(rpcMock).toHaveBeenCalledOnce();
  });
});
