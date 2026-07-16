/**
 * Tests for POST /api/push/send-streak-nudge (#1950).
 *
 * Mirrors app/api/push/send-daily/route.test.tsx's structure: auth/config
 * gates, the RPC-based read surface (get_push_targets / get_push_streak_days
 * / get_push_reviewed_today, migrations 046/047), the late-hour fan-out, the
 * collision guard against the primary reminder, the opt-in gate, the
 * reviewed-today drop, and the genuinely-at-risk streak filter (including the
 * honesty case where a protection token would auto-bridge the gap).
 *
 * `web-push` and the Supabase service-role client are mocked at module level
 * so the test never touches the network and never sends a real push.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

// Pin the timezone helper so tests are deterministic regardless of system
// clock, same approach as send-daily's test.
vi.mock("@/lib/utils/format-date", () => ({
  todayInTimezone: () => "2026-05-20",
  isoDate: (d: Date) => d.toISOString().slice(0, 10),
}));

import { POST, buildStreakNudgeMessage, STREAK_NUDGE_LOCAL_HOUR } from "./route";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const mockSendNotification = vi.mocked(webpush.sendNotification);
const mockSetVapidDetails = vi.mocked(webpush.setVapidDetails);
const mockCreateClient = vi.mocked(createClient);

function makeRequest(secret = "secret-value"): Request {
  return new Request("http://localhost/api/push/send-streak-nudge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: "{}",
  });
}

type TargetRow = {
  subscription_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  timezone: string | null;
  settings: Record<string, unknown> | null;
  push_notification_hour: number | null;
};

type StreakDayRow = { user_id: string; review_date: string };
type ReviewedTodayRow = { user_id: string };

/**
 * Builds a Supabase admin-client mock covering the three RPCs the route
 * calls (get_push_targets, get_push_reviewed_today, get_push_streak_days)
 * plus the dead-endpoint DELETE.
 */
function buildAdminMock(opts: {
  targets?: TargetRow[];
  targetsError?: unknown;
  reviewedToday?: ReviewedTodayRow[];
  reviewedTodayError?: unknown;
  streakDays?: StreakDayRow[];
  streakDaysError?: unknown;
  deleteError?: unknown;
  deleteCount?: number;
}) {
  const targets = opts.targets ?? [];
  const reviewedToday = opts.reviewedToday ?? [];
  const streakDays = opts.streakDays ?? [];
  const deleteCount = opts.deleteCount ?? 0;
  const deleteCalls: Array<{ ids: unknown[] }> = [];

  const rpc = vi.fn((fn: string, _args?: Record<string, unknown>) => {
    if (fn === "get_push_targets") {
      return Promise.resolve({
        data: opts.targetsError ? null : targets,
        error: opts.targetsError ?? null,
      });
    }
    if (fn === "get_push_reviewed_today") {
      return Promise.resolve({
        data: opts.reviewedTodayError ? null : reviewedToday,
        error: opts.reviewedTodayError ?? null,
      });
    }
    if (fn === "get_push_streak_days") {
      return Promise.resolve({
        data: opts.streakDaysError ? null : streakDays,
        error: opts.streakDaysError ?? null,
      });
    }
    throw new Error(`Unexpected RPC call: ${fn}`);
  });

  const from = vi.fn((_table: string) => ({
    delete: vi.fn((_opts?: unknown) => ({
      in: vi.fn((_col: string, ids: unknown[]) => {
        deleteCalls.push({ ids });
        return Promise.resolve({ error: opts.deleteError ?? null, count: deleteCount });
      }),
    })),
  }));

  return { client: { rpc, from }, deleteCalls };
}

/** A target row with the opt-in on, UTC timezone, no daily-hour preference. */
function optedInTarget(overrides: Partial<TargetRow> = {}): TargetRow {
  return {
    subscription_id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
    timezone: "UTC",
    settings: { streakNudgeEnabled: true },
    push_notification_hour: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SHARED_SECRET = "secret-value";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "vapid-pub";
  process.env.VAPID_PRIVATE_KEY = "vapid-priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  // Pin the clock to STREAK_NUDGE_LOCAL_HOUR UTC (UTC timezone in the
  // fixtures above, so local hour === UTC hour). Tests that need a different
  // hour override via vi.setSystemTime locally.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`2026-05-20T${String(STREAK_NUDGE_LOCAL_HOUR).padStart(2, "0")}:00:00Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── buildStreakNudgeMessage ────────────────────────────────────────────────

describe("buildStreakNudgeMessage", () => {
  it("renders the streak length into the body", async () => {
    const msg = await buildStreakNudgeMessage(7);
    expect(msg.title).toBe("Keep your streak going");
    expect(msg.body).toContain("7");
    expect(msg.url).toBe("/");
  });

  it("does not use em dashes", async () => {
    const msg = await buildStreakNudgeMessage(3);
    expect(msg.body).not.toContain("—");
    expect(msg.title).not.toContain("—");
  });
});

// ─── Auth and config gates ──────────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - auth and config gates", () => {
  it("returns 503 when CRON_SHARED_SECRET is unset", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  it("returns 503 when VAPID_PRIVATE_KEY is unset", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = new Request("http://localhost/api/push/send-streak-nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer secret does not match", async () => {
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });
});

// ─── Happy path / RPC wiring ────────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - happy path", () => {
  it("returns 200 and sends zero notifications when no subscriptions exist", async () => {
    const admin = buildAdminMock({ targets: [] });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number };
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSetVapidDetails).toHaveBeenCalled();
  });

  it("returns 502 when get_push_targets errors", async () => {
    const admin = buildAdminMock({ targetsError: { message: "boom" } });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toBe("targets_query_failed");
  });

  it("sends a nudge to an opted-in user with an active, genuinely-at-risk streak", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      reviewedToday: [],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number };
    expect(body.sent).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(admin.client.rpc).toHaveBeenCalledWith("get_push_targets");
    expect(admin.client.rpc).toHaveBeenCalledWith("get_push_reviewed_today", {
      user_ids: ["user-a"],
      today_input: "2026-05-20",
    });
    expect(admin.client.rpc).toHaveBeenCalledWith("get_push_streak_days", {
      user_ids: ["user-a"],
    });
  });
});

// ─── Gate A: opt-in ─────────────────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - opt-in gate", () => {
  it("skips a user whose streakNudgeEnabled is false", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget({ settings: { streakNudgeEnabled: false } })],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("skips a user with no settings row at all (default false)", async () => {
    const admin = buildAdminMock({ targets: [optedInTarget({ settings: null })] });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
  });
});

// ─── Gate B: late-hour fan-out ──────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - late-hour fan-out", () => {
  it("does not send when the current UTC hour is not the user's local nudge hour", async () => {
    vi.setSystemTime(new Date("2026-05-20T09:00:00Z"));
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

// ─── Gate C: collision guard ────────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - collision guard", () => {
  it("skips the nudge when the primary reminder's hour is within 3 hours (UTC, same tz)", async () => {
    // Nudge hour = STREAK_NUDGE_LOCAL_HOUR (20 UTC in this UTC-tz fixture).
    // Primary reminder set to 18:00 local - 2 hours away - within the guard.
    const admin = buildAdminMock({
      targets: [optedInTarget({ push_notification_hour: STREAK_NUDGE_LOCAL_HOUR - 2 })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("still sends when the primary reminder's hour is well clear of the nudge hour", async () => {
    // Primary reminder at 08:00, nudge at 20:00 - 12 hours apart, clear of the guard.
    const admin = buildAdminMock({
      targets: [optedInTarget({ push_notification_hour: 8 })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
  });
});

// ─── Gate D: reviewed-today ─────────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - reviewed-today gate", () => {
  it("skips a user who has already reviewed today", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      reviewedToday: [{ user_id: "user-a" }],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
    // The streak-days RPC should never be called - reviewed-today users are
    // dropped before the (more expensive) streak query.
    expect(admin.client.rpc).not.toHaveBeenCalledWith(
      "get_push_streak_days",
      expect.anything(),
    );
  });

  it("returns 502 when get_push_reviewed_today errors", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      reviewedTodayError: { message: "boom" },
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("reviewed_today_query_failed");
  });
});

// ─── Gate E: genuinely-at-risk streak (incl. honesty case) ─────────────────

describe("POST /api/push/send-streak-nudge - at-risk streak gate", () => {
  it("skips a user with no active streak", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [{ user_id: "user-a", review_date: "2026-05-01" }],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
  });

  it("skips a user whose streak-protection token would auto-bridge tonight's gap (honesty case)", async () => {
    const admin = buildAdminMock({
      targets: [
        optedInTarget({
          settings: {
            streakNudgeEnabled: true,
            streakProtection: { balance: 1, spendDates: [], daysSinceLastEarn: 0, lastEarnCheckDate: null, protectionEvents: [], lastAcknowledgedProtectionEventDate: null },
          },
        }),
      ],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("returns 502 when get_push_streak_days errors", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDaysError: { message: "boom" },
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("streak_days_query_failed");
  });
});

// ─── Dead-endpoint cleanup ──────────────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - dead-endpoint cleanup", () => {
  it("deletes a subscription that returns 410 Gone", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
      deleteCount: 1,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockRejectedValue(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number; deleted: number };
    expect(body.sent).toBe(0);
    expect(body.deleted).toBe(1);
    expect(admin.deleteCalls).toEqual([{ ids: ["sub-1"] }]);
  });

  it("keeps a subscription that returns a transient error (500)", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockRejectedValue(
      Object.assign(new Error("Server error"), { statusCode: 500 }),
    );

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number; deleted: number };
    expect(body.sent).toBe(0);
    expect(body.deleted).toBe(0);
    expect(admin.client.from).not.toHaveBeenCalled();
  });
});
