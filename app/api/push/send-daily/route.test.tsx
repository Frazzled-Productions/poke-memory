/**
 * Tests for POST /api/push/send-daily.
 *
 * Verifies the auth gate, the misconfiguration short-circuit, the per-user
 * fan-out, the dead-endpoint cleanup, and the buildDailyMessage copy.
 *
 * `web-push` and the Supabase service-role client are mocked at module
 * level so the test never touches the network and never sends a real push.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
// clock. The route calls todayInTimezone(tz) per user; returning the same
// stub date keeps the assertions tractable.
vi.mock("@/lib/utils/format-date", () => ({
  todayInTimezone: () => "2026-05-20",
}));

import { POST, buildDailyMessage } from "./route";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const mockSendNotification = vi.mocked(webpush.sendNotification);
const mockSetVapidDetails = vi.mocked(webpush.setVapidDetails);
const mockCreateClient = vi.mocked(createClient);

/** Convenience: a request with the right Bearer header. */
function makeRequest(secret = "secret-value"): Request {
  return new Request("http://localhost/api/push/send-daily", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: "{}",
  });
}

type FromBuilder = {
  select?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  in?: ReturnType<typeof vi.fn>;
  eq?: ReturnType<typeof vi.fn>;
  lte?: ReturnType<typeof vi.fn>;
  is?: ReturnType<typeof vi.fn>;
};

/**
 * Build a thenable-style Supabase mock that returns the given fixtures
 * for each `.from(table)` call. The route's query shape is:
 *
 *   from("push_subscriptions").select(...)           → subs
 *   from("user_settings").select(...).in(...)        → settings
 *   from("card_reviews").select(...).lte().in().is() → due rows
 *   from("push_subscriptions").delete().in()         → delete
 *
 * The route used to issue a second per-user COUNT query inside a loop —
 * that's been collapsed (see commit history). Now per-user counts come from
 * counting matching rows in the single `.select("user_id")` result. To
 * configure a test where user-a has 3 due cards, pass three matching rows
 * in `due`. The helper `dueRowsFor({ "user-a": 3 })` builds them.
 */
function buildAdminMock(opts: {
  subscriptions?: Array<Record<string, unknown>>;
  subsError?: unknown;
  settings?: Array<{ user_id: string; timezone: string | null }>;
  due?: Array<{ user_id: string }>;
  deleteError?: unknown;
  deleteCount?: number;
}) {
  const subsRows = opts.subscriptions ?? [];
  const settingsRows = opts.settings ?? [];
  const dueRows = opts.due ?? [];
  const deleteCount = opts.deleteCount ?? 0;

  const deleteCalls: Array<{ ids: unknown[] }> = [];

  const from = vi.fn((table: string) => {
    if (table === "push_subscriptions") {
      const builder = {
        select: vi.fn(() =>
          Promise.resolve({ data: subsRows, error: opts.subsError ?? null }),
        ),
        delete: vi.fn((_opts?: unknown) => ({
          in: vi.fn((_col: string, ids: unknown[]) => {
            deleteCalls.push({ ids });
            return Promise.resolve({
              error: opts.deleteError ?? null,
              count: deleteCount,
            });
          }),
        })),
      };
      return builder;
    }
    if (table === "user_settings") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => Promise.resolve({ data: settingsRows, error: null })),
        })),
      };
    }
    // card_reviews — one "due rows" select chain, no inline count path.
    return {
      select: vi.fn(() => {
        const builder = {
          lte: vi.fn(() => builder),
          in: vi.fn(() => builder),
          is: vi.fn(() => Promise.resolve({ data: dueRows, error: null })),
        };
        return builder;
      }),
    };
  });

  return { client: { from }, deleteCalls };
}

/**
 * Builds an array of `{ user_id }` rows that, when fed into the mocked
 * `card_reviews` select chain, makes the route observe `counts[userId]`
 * due cards for each user.
 */
function dueRowsFor(counts: Record<string, number>): Array<{ user_id: string }> {
  const rows: Array<{ user_id: string }> = [];
  for (const [userId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) rows.push({ user_id: userId });
  }
  return rows;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SHARED_SECRET = "secret-value";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "vapid-pub";
  process.env.VAPID_PRIVATE_KEY = "vapid-priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

describe("buildDailyMessage", () => {
  it("uses singular form for one due card", () => {
    const msg = buildDailyMessage(1);
    expect(msg.title).toBe("Time to practise");
    expect(msg.body).toBe("1 Pokémon is ready for review.");
    expect(msg.url).toBe("/");
  });

  it("uses plural form for multiple due cards", () => {
    const msg = buildDailyMessage(7);
    expect(msg.body).toContain("7 Pokémon are ready for review.");
  });

  it("does not use em dashes anywhere in the message", () => {
    expect(buildDailyMessage(1).body).not.toContain("—");
    expect(buildDailyMessage(5).body).not.toContain("—");
    expect(buildDailyMessage(1).title).not.toContain("—");
  });
});

describe("POST /api/push/send-daily — auth and config gates", () => {
  it("returns 503 when CRON_SHARED_SECRET is unset", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("misconfigured");
  });

  it("returns 503 when VAPID_PRIVATE_KEY is unset", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const req = new Request("http://localhost/api/push/send-daily", {
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
  });

  it("returns 401 with an empty body so the route does not leak metadata", async () => {
    const res = await POST(makeRequest("wrong-secret"));
    expect(res.status).toBe(401);
    // The body must be empty: no JSON `error` field, no header schema hint,
    // nothing that helps an unauthenticated caller probe the endpoint.
    expect(await res.text()).toBe("");
  });

  it("treats a Bearer with the wrong length as unauthorised without throwing", async () => {
    // The constant-time check requires equal-length buffers; a shorter or
    // longer header must still return 401 cleanly rather than crashing.
    const res = await POST(makeRequest("x"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/push/send-daily — happy path", () => {
  it("returns 200 and sends zero notifications when no subscriptions exist", async () => {
    const admin = buildAdminMock({ subscriptions: [] });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number };
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:test@example.com",
      "vapid-pub",
      "vapid-priv",
    );
  });

  it("sends a notification to a subscriber with due cards", async () => {
    const admin = buildAdminMock({
      subscriptions: [
        {
          id: "sub-1",
          user_id: "user-a",
          endpoint: "https://push.example/a",
          p256dh: "p256-a",
          auth_secret: "auth-a",
        },
      ],
      settings: [{ user_id: "user-a", timezone: "Europe/London" }],
      due: dueRowsFor({ "user-a": 3 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({
      statusCode: 201,
      body: "",
      headers: {},
    });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number };
    expect(body.sent).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const [target, payload] = mockSendNotification.mock.calls[0];
    expect(target).toEqual({
      endpoint: "https://push.example/a",
      keys: { p256dh: "p256-a", auth: "auth-a" },
    });
    expect(typeof payload).toBe("string");
    const parsed = JSON.parse(payload as string) as { title: string; body: string };
    expect(parsed.body).toContain("3");
  });

  it("does not send a notification to a subscriber with zero due cards", async () => {
    const admin = buildAdminMock({
      subscriptions: [
        {
          id: "sub-1",
          user_id: "user-a",
          endpoint: "https://push.example/a",
          p256dh: "p256-a",
          auth_secret: "auth-a",
        },
      ],
      settings: [{ user_id: "user-a", timezone: "UTC" }],
      due: [], // no due cards
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

describe("POST /api/push/send-daily — dead-endpoint cleanup", () => {
  it("deletes a subscription that returns 410 Gone", async () => {
    const admin = buildAdminMock({
      subscriptions: [
        {
          id: "sub-1",
          user_id: "user-a",
          endpoint: "https://push.example/a",
          p256dh: "p256-a",
          auth_secret: "auth-a",
        },
      ],
      settings: [{ user_id: "user-a", timezone: "UTC" }],
      due: dueRowsFor({ "user-a": 1 }),
      deleteCount: 1,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const gone = { statusCode: 410, body: "Gone", headers: {} };
    mockSendNotification.mockRejectedValueOnce(gone);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number; deleted: number };
    expect(body.sent).toBe(0);
    expect(body.deleted).toBe(1);
    expect(admin.deleteCalls).toEqual([{ ids: ["sub-1"] }]);
  });

  it("deletes a subscription that returns 404 Not Found", async () => {
    const admin = buildAdminMock({
      subscriptions: [
        {
          id: "sub-1",
          user_id: "user-a",
          endpoint: "https://push.example/a",
          p256dh: "p256-a",
          auth_secret: "auth-a",
        },
      ],
      settings: [{ user_id: "user-a", timezone: "UTC" }],
      due: dueRowsFor({ "user-a": 2 }),
      deleteCount: 1,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockRejectedValueOnce({ statusCode: 404, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(1);
  });

  it("keeps a subscription that returns a transient error (500)", async () => {
    const admin = buildAdminMock({
      subscriptions: [
        {
          id: "sub-1",
          user_id: "user-a",
          endpoint: "https://push.example/a",
          p256dh: "p256-a",
          auth_secret: "auth-a",
        },
      ],
      settings: [{ user_id: "user-a", timezone: "UTC" }],
      due: dueRowsFor({ "user-a": 1 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockRejectedValueOnce({ statusCode: 500, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(0);
    expect(admin.deleteCalls).toEqual([]);
  });
});
