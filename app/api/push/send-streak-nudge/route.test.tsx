/**
 * Tests for POST /api/push/send-streak-nudge (#1950).
 *
 * Mirrors app/api/push/send-daily/route.test.tsx's structure: auth/config
 * gates, the RPC-based read surface (get_push_targets / get_push_streak_days,
 * migrations 046/047), the late-hour fan-out, the
 * collision guard against the primary reminder, the opt-in gate, the
 * reviewed-today drop (derived from local-day `streak_days`, #2073), and the
 * genuinely-at-risk streak filter (including the
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

// `todayInTimezone` is deliberately NOT mocked (#2073): the timezone tests
// below depend on the real local-day maths. Determinism comes from
// `vi.setSystemTime` in beforeEach.

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

/** PostgREST's default per-response row cap (the `max_rows` setting). */
const POSTGREST_MAX_ROWS = 1000;

/**
 * Builds a Supabase admin-client mock covering the two RPCs the route
 * calls (get_push_targets, get_push_streak_days)
 * plus the dead-endpoint DELETE.
 */
function buildAdminMock(opts: {
  targets?: TargetRow[];
  targetsError?: unknown;
  streakDays?: StreakDayRow[];
  streakDaysError?: unknown;
  /** Fail any page whose start offset is >= this (simulates a later-page error). */
  streakDaysErrorFromOffset?: number;
  deleteError?: unknown;
  deleteCount?: number;
}) {
  const targets = opts.targets ?? [];
  const streakDays = opts.streakDays ?? [];
  const deleteCount = opts.deleteCount ?? 0;
  const deleteCalls: Array<{ ids: unknown[] }> = [];
  const streakDayPages: Array<{
    from: number;
    to: number;
    orders: Array<{ column: string; ascending: boolean }>;
  }> = [];

  const rpc = vi.fn((fn: string, _args?: Record<string, unknown>) => {
    if (fn === "get_push_targets") {
      return Promise.resolve({
        data: opts.targetsError ? null : targets,
        error: opts.targetsError ?? null,
      });
    }
    if (fn === "get_push_reviewed_today") {
      // Gate D no longer uses this RPC (#2073); any call is a regression.
      throw new Error("get_push_reviewed_today must not be called (#2073)");
    }
    if (fn === "get_push_streak_days") {
      // Emulates PostgREST on a set-returning RPC: `.order()` is chainable and
      // `.range(from, to)` resolves one inclusive page. Like PostgREST, a
      // request is capped at POSTGREST_MAX_ROWS regardless of the range asked
      // for, so an unpaginated read would silently truncate (#2115).
      const orders: Array<{ column: string; ascending: boolean }> = [];
      type Builder = {
        order: (column: string, o?: { ascending?: boolean }) => Builder;
        range: (from: number, to: number) => Promise<unknown>;
      };
      const builder: Builder = {
        order: (column, o) => {
          orders.push({ column, ascending: o?.ascending ?? true });
          return builder;
        },
        range: (from: number, to: number) => {
          streakDayPages.push({ from, to, orders: [...orders] });
          if (
            opts.streakDaysError ||
            (opts.streakDaysErrorFromOffset !== undefined && from >= opts.streakDaysErrorFromOffset)
          ) {
            return Promise.resolve({
              data: null,
              error: opts.streakDaysError ?? { message: "page failed" },
            });
          }
          const sorted = [...streakDays].sort(
            (a, b) =>
              a.user_id.localeCompare(b.user_id) ||
              a.review_date.localeCompare(b.review_date),
          );
          const end = Math.min(to, from + POSTGREST_MAX_ROWS - 1);
          return Promise.resolve({ data: sorted.slice(from, end + 1), error: null });
        },
      };
      return builder;
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

  return { client: { rpc, from }, deleteCalls, streakDayPages };
}

/** `count` consecutive "YYYY-MM-DD" dates ending on `endDate` (inclusive). */
function consecutiveDatesEnding(endDate: string, count: number): string[] {
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) =>
    new Date(end - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
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

describe("POST /api/push/send-streak-nudge - reviewed-today gate (streak_days, #2073)", () => {
  it("skips a user whose local today is already in streak_days", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-19" },
        { user_id: "user-a", review_date: "2026-05-20" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("learning-steps-only practice: today's streak day recorded suppresses the nudge with no card_reviews involvement", async () => {
    // No graduation means no card_reviews.last_review = today; the streak day
    // alone must be enough.
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
        { user_id: "user-a", review_date: "2026-05-20" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    await POST(makeRequest());
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("west of UTC: nudges a Los Angeles user whose last streak day was yesterday-local, even though that review fell on today's UTC date", async () => {
    // 20:00 local PDT on 16 Sep = 03:00 UTC on 17 Sep. Last practice 18:30
    // local on 15 Sep (01:30 UTC on 16 Sep): streak day is 2026-09-15.
    vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
    const admin = buildAdminMock({
      targets: [optedInTarget({ timezone: "America/Los_Angeles" })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-09-14" },
        { user_id: "user-a", review_date: "2026-09-15" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
  });

  it("west of UTC: a Los Angeles user who kept today-local (streak day 16 Sep) is not nudged", async () => {
    vi.setSystemTime(new Date("2026-09-17T03:00:00Z"));
    const admin = buildAdminMock({
      targets: [optedInTarget({ timezone: "America/Los_Angeles" })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-09-15" },
        { user_id: "user-a", review_date: "2026-09-16" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("east of UTC: a Tokyo user who practised this morning-local (streak day 16 Sep, review on 15 Sep UTC) is not nudged", async () => {
    // 20:00 JST on 16 Sep = 11:00 UTC on 16 Sep. Morning review at 07:30 JST
    // was 22:30 UTC on 15 Sep, so last_review would be 2026-09-15 (UTC).
    vi.setSystemTime(new Date("2026-09-16T11:00:00Z"));
    const admin = buildAdminMock({
      targets: [optedInTarget({ timezone: "Asia/Tokyo" })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-09-15" },
        { user_id: "user-a", review_date: "2026-09-16" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("east of UTC: a Tokyo user who has not practised today-local is nudged", async () => {
    vi.setSystemTime(new Date("2026-09-16T11:00:00Z"));
    const admin = buildAdminMock({
      targets: [optedInTarget({ timezone: "Asia/Tokyo" })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-09-14" },
        { user_id: "user-a", review_date: "2026-09-15" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
  });

  it.each([
    ["null", null],
    ["invalid", "Not/AZone"],
  ])("%s timezone falls back to UTC consistently across gate B and gate D", async (_label, tz) => {
    // System time is 20:00Z, so UTC-fallback local hour is 20 (gate B passes)
    // and UTC today is 2026-05-20 (gate D).
    const atRisk = buildAdminMock({
      targets: [optedInTarget({ timezone: tz })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-18" },
        { user_id: "user-a", review_date: "2026-05-19" },
      ],
    });
    mockCreateClient.mockReturnValue(atRisk.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const sentBody = (await (await POST(makeRequest())).json()) as { sent: number };
    expect(sentBody.sent).toBe(1);

    mockSendNotification.mockClear();
    const reviewed = buildAdminMock({
      targets: [optedInTarget({ timezone: tz })],
      streakDays: [
        { user_id: "user-a", review_date: "2026-05-19" },
        { user_id: "user-a", review_date: "2026-05-20" },
      ],
    });
    mockCreateClient.mockReturnValue(reviewed.client as unknown as ReturnType<typeof createClient>);
    const skippedBody = (await (await POST(makeRequest())).json()) as { sent: number };
    expect(skippedBody.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("never calls get_push_reviewed_today (the UTC last_review RPC)", async () => {
    const admin = buildAdminMock({ targets: [optedInTarget()] });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    await POST(makeRequest());
    expect(admin.client.rpc).not.toHaveBeenCalledWith("get_push_reviewed_today", expect.anything());
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

// ─── streak_days pagination (#2115) ──────────────────────────────────────────

describe("POST /api/push/send-streak-nudge - streak_days pagination (#2115)", () => {
  it("pages past the PostgREST cap so the last user's latest dates are not truncated", async () => {
    // user-a alone fills the whole first page (exactly the cap). user-b sorts
    // after it, so its rows only arrive on page two. Without pagination user-b
    // would look as if it had NOT reviewed today and get a false nudge.
    const streakDays: StreakDayRow[] = [
      ...consecutiveDatesEnding("2026-05-19", POSTGREST_MAX_ROWS).map((review_date) => ({
        user_id: "user-a",
        review_date,
      })),
      { user_id: "user-b", review_date: "2026-05-19" },
      { user_id: "user-b", review_date: "2026-05-20" },
    ];
    const admin = buildAdminMock({
      targets: [
        optedInTarget(),
        optedInTarget({
          subscription_id: "sub-2",
          user_id: "user-b",
          endpoint: "https://push.example/b",
        }),
      ],
      streakDays,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number };

    // user-a (streak at risk, not reviewed today) is nudged; user-b reviewed
    // today (only visible on page two) is not.
    expect(body.sent).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification.mock.calls[0][0].endpoint).toBe("https://push.example/a");

    expect(admin.streakDayPages.map((p) => [p.from, p.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("orders every page by the unique key (user_id, review_date) so offset pages are stable", async () => {
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: [{ user_id: "user-a", review_date: "2026-05-19" }],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    expect(admin.streakDayPages).toHaveLength(1);
    expect(admin.streakDayPages[0].orders).toEqual([
      { column: "user_id", ascending: true },
      { column: "review_date", ascending: true },
    ]);
  });

  it("returns 502 when a later page errors rather than acting on partial data", async () => {
    // First page succeeds (full), second errors: must not fall through with a
    // truncated history.
    const full: StreakDayRow[] = consecutiveDatesEnding("2026-05-19", POSTGREST_MAX_ROWS).map(
      (review_date) => ({ user_id: "user-a", review_date }),
    );
    const admin = buildAdminMock({
      targets: [optedInTarget()],
      streakDays: full,
      streakDaysErrorFromOffset: POSTGREST_MAX_ROWS,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("streak_days_query_failed");
    expect(mockSendNotification).not.toHaveBeenCalled();
    // Page 1 succeeded (full), page 2 was requested and failed.
    expect(admin.streakDayPages.map((p) => [p.from, p.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("tolerates a row duplicated across a page boundary (non-atomic pages)", async () => {
    // 1000 days ending yesterday fill page one; a second copy of the last date
    // lands on page two, as if a concurrent write shifted the boundary.
    const dates = consecutiveDatesEnding("2026-05-19", POSTGREST_MAX_ROWS);
    const streakDays: StreakDayRow[] = [
      ...dates.map((review_date) => ({ user_id: "user-a", review_date })),
      { user_id: "user-a", review_date: "2026-05-19" },
    ];
    const admin = buildAdminMock({ targets: [optedInTarget()], streakDays });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(admin.streakDayPages).toHaveLength(2);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1] as string) as { body: string };
    // Streak length is 1000 (localised as "1,000"), not inflated by the duplicate.
    expect(payload.body).toContain("1,000 days");
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
