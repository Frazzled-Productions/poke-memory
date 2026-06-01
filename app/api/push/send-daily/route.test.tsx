/**
 * Tests for POST /api/push/send-daily.
 *
 * Verifies the auth gate, the misconfiguration short-circuit, the per-user
 * fan-out, the dead-endpoint cleanup, and the buildDailyMessage copy.
 *
 * Also covers #1153: per-user settings filtering (card-type flags and the
 * alt-forms toggle) and the new-card estimate added to the push body.
 *
 * `web-push` and the Supabase service-role client are mocked at module
 * level so the test never touches the network and never sends a real push.
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

/** Shape the route now reads from card_reviews. */
type DueRow = {
  user_id: string;
  card_type: string;
  subject_key: string;
  first_seen: string | null;
  /** Migration 029 locale column — part of the PK (#1480). */
  locale: string;
};

/** Shape the route reads from user_settings. */
type SettingsMockRow = {
  user_id: string;
  timezone: string | null;
  settings?: Record<string, unknown> | null;
  /** push_notification_hour (migration 030, #1315). null = no preference. */
  push_notification_hour?: number | null;
};

/**
 * All-enabled settings JSONB that matches DEFAULT_SETTINGS. Used when a test
 * just needs "every card type on" without caring about the specific values.
 *
 * Note: nameCardsEnabled and reverseCardsEnabled are not present — name and
 * reverse are always on since #1234 and are no longer stored in settings.
 */
const ALL_ENABLED_SETTINGS: Record<string, unknown> = {
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: true,
  cryCardsEnabled: true,
  alternateFormsEnabled: true,
  maxNewPerDay: 10,
  maxNewEvolutionPerDay: 5,
  maxNewReversePerDay: 10,
  maxNewCryPerDay: 10,
};

/**
 * Build a thenable-style Supabase mock that returns the given fixtures
 * for each `.from(table)` call. The route's query shape is:
 *
 *   from("push_subscriptions").select(...)                     → subs
 *   from("user_settings").select(...).in(...)                  → settings
 *   from("card_reviews").select(...).lte().in().is()           → due rows
 *   from("push_subscriptions").delete().in()                   → delete
 *
 * Per-user counts come from counting eligible rows in the `.select()` result.
 * To configure a test where user-a has 3 due `name` cards, pass three
 * `{ user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" }`
 * rows in `due`. The helper `dueRowsFor` builds them (always locale="en").
 */
function buildAdminMock(opts: {
  subscriptions?: Array<Record<string, unknown>>;
  subsError?: unknown;
  settings?: SettingsMockRow[];
  due?: DueRow[];
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
    // card_reviews — chained lte().in().is() returning the due rows array.
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
 * Builds an array of due rows where each row is a `name` card with a
 * sequential subject_key, first_seen=null (not started today), locale="en".
 * Use this for tests that just need N due cards without caring about card
 * type, alt-forms, or locale.
 */
function dueRowsFor(counts: Record<string, number>): DueRow[] {
  const rows: DueRow[] = [];
  for (const [userId, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      rows.push({
        user_id: userId,
        card_type: "name",
        subject_key: String(i + 1),
        first_seen: null,
        locale: "en",
      });
    }
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
  // Pin the system clock to 08:00 UTC so the per-user hour gate
  // (shouldSendToUser) passes for NULL-preference users (default = 8).
  // Tests that need a different UTC hour override via vi.setSystemTime locally.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-20T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buildDailyMessage", () => {
  it("renders due-only copy when newEstimate is 0 or omitted", () => {
    const msg = buildDailyMessage(3);
    expect(msg.title).toBe("Time to practise");
    expect(msg.body).toBe("3 cards due for review.");
    expect(msg.url).toBe("/");
  });

  it("uses singular 'card' for one due card with no new estimate", () => {
    const msg = buildDailyMessage(1, 0);
    expect(msg.body).toBe("1 card due for review.");
  });

  it("renders combined copy when both due and new are positive", () => {
    expect(buildDailyMessage(13, 15).body).toBe("13 cards due plus 15 new ready to practise.");
    expect(buildDailyMessage(1, 1).body).toBe("1 card due plus 1 new ready to practise.");
  });

  it("renders new-only copy when dueCount is 0 but newEstimate is positive", () => {
    expect(buildDailyMessage(0, 10).body).toBe("10 new cards ready to practise.");
    expect(buildDailyMessage(0, 1).body).toBe("1 new card ready to practise.");
  });

  it("does not use em dashes anywhere in the message", () => {
    expect(buildDailyMessage(1).body).not.toContain("—");
    expect(buildDailyMessage(5, 3).body).not.toContain("—");
    expect(buildDailyMessage(1).title).not.toContain("—");
  });

  it("uses British English 'practise' in copy", () => {
    expect(buildDailyMessage(3, 5).body).toContain("practise");
    expect(buildDailyMessage(0, 5).body).toContain("practise");
    expect(buildDailyMessage(3, 5).body).not.toContain("practice");
    expect(buildDailyMessage(0, 5).body).not.toContain("practice");
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
      settings: [{ user_id: "user-a", timezone: "Europe/London", settings: ALL_ENABLED_SETTINGS }],
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

  it("does not send a notification to a subscriber with zero due cards and zero new estimate", async () => {
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
      // All optional card types disabled + daily caps zeroed → no due cards,
      // no new estimate. Name and reverse are always on since #1234, so the
      // only way to reach estimate = 0 is to set both caps to 0.
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: false,
          maxNewPerDay: 0,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due: [], // no due cards
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sends a notification even when dueCount is 0 but newEstimate is positive (new cards only)", async () => {
    // No due rows. Name cards always on (maxNewPerDay=10); reverse capped to 0
    // so the estimate is deterministic (= 10). Other optional card types off.
    // Since name and reverse are always on since #1234, maxNewReversePerDay=0
    // is the way to isolate name-only headroom.
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
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // dueCount = 0, newEstimate = 10 (name headroom; reverse capped at 0) → new-only copy.
    expect(parsed.body).toContain("new");
    expect(parsed.body).toContain("10");
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
      settings: [{ user_id: "user-a", timezone: "UTC", settings: ALL_ENABLED_SETTINGS }],
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
      settings: [{ user_id: "user-a", timezone: "UTC", settings: ALL_ENABLED_SETTINGS }],
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
      settings: [{ user_id: "user-a", timezone: "UTC", settings: ALL_ENABLED_SETTINGS }],
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

// ─── #1153: per-user settings filtering ───────────────────────────────────────

describe("POST /api/push/send-daily — card-type filtering (#1153)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("all flags on: counts all enabled card types normally", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: ALL_ENABLED_SETTINGS,
      }],
      due: [
        { user_id: "user-a", card_type: "name",                   subject_key: "1",   first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse",                subject_key: "1",   first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "evolution-edge",         subject_key: "1>>>2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse-evolution-edge", subject_key: "1>>>2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "cry",                    subject_key: "1",   first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // All 5 rows eligible, dueCount = 5.
    expect(parsed.body).toContain("5");
  });

  it("reverse cards are always eligible — counts name and reverse due rows (#1234)", async () => {
    // Since #1234, reverse is always on. All 3 due rows (1 name + 2 reverse)
    // must be counted. The old reverseCardsEnabled: false toggle no longer exists.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          cryCardsEnabled: true,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name",    subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse",  subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse",  subject_key: "2", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // All 3 rows are eligible — name and reverse are both always on.
    expect(parsed.body.startsWith("3 cards due")).toBe(true);
  });

  it("alternateFormsEnabled: false — excludes name/reverse/cry rows with species id >= 10000", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: false, // ← alt-forms off
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "25",    first_seen: null, locale: "en" }, // Pikachu — kept
        { user_id: "user-a", card_type: "name", subject_key: "10004", first_seen: null, locale: "en" }, // alt-form — excluded
        { user_id: "user-a", card_type: "name", subject_key: "10098", first_seen: null, locale: "en" }, // alt-form — excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only Pikachu's name card (id=25) passes; the two alt-form rows are excluded.
    expect(parsed.body).toContain("1");
    expect(parsed.body).not.toContain("3");
  });

  it("alternateFormsEnabled: false — excludes evolution-edge rows where either endpoint is >= 10000", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: false, // ← alt-forms off
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "133>>>134",     first_seen: null, locale: "en" }, // Eevee→Vaporeon — kept
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "10027>>>10028", first_seen: null, locale: "en" }, // alt-form — excluded
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "26>>>10023",    first_seen: null, locale: "en" }, // post-evo alt-form — excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only the Eevee→Vaporeon edge (both ids < 10000) passes.
    expect(parsed.body).toContain("1");
    expect(parsed.body).not.toContain("3");
  });

  it("combined: alternateFormsEnabled off — reproduces the #1153 scenario with always-on reverse (#1234)", async () => {
    // Mirrors the observed production data: 8 name rows (3 default + 5 alt),
    // 6 reverse rows (5 default + 1 alt), 4 evolution-edge, 1 reverse-evo-edge.
    // With alt-forms off and reverse always on (since #1234), expected due count
    // = 3 name default + 5 reverse default + 4 evo + 1 rev-evo = 13.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          cryCardsEnabled: false,
          alternateFormsEnabled: false,   // ← alt-forms off
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        // 3 name default
        { user_id: "user-a", card_type: "name", subject_key: "1",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "4",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "7",  first_seen: null, locale: "en" },
        // 5 name alt-form (excluded by alt-forms gate)
        { user_id: "user-a", card_type: "name", subject_key: "10004",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "10098",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "10116",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "10123",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "10176",  first_seen: null, locale: "en" },
        // 5 reverse default (all eligible — reverse always on since #1234)
        { user_id: "user-a", card_type: "reverse", subject_key: "25",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse", subject_key: "26",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse", subject_key: "27",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse", subject_key: "28",  first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "reverse", subject_key: "29",  first_seen: null, locale: "en" },
        // 1 reverse alt-form (excluded by alt-forms gate)
        { user_id: "user-a", card_type: "reverse", subject_key: "10027", first_seen: null, locale: "en" },
        // 4 evolution-edge (default ids — all pass)
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "1>>>2",   first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "2>>>3",   first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "4>>>5",   first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "5>>>6",   first_seen: null, locale: "en" },
        // 1 reverse-evolution-edge (default ids — passes)
        { user_id: "user-a", card_type: "reverse-evolution-edge", subject_key: "4>>>5", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // 3 name (default) + 5 reverse (default) + 4 evolution-edge + 1 reverse-evolution-edge = 13 due.
    // The push body must contain "13" and not "19" (the raw pre-filter count).
    expect(parsed.body).toContain("13");
    expect(parsed.body).not.toContain("19");
  });
});

describe("POST /api/push/send-daily — new-card estimate (#1153)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("includes a new-card estimate in the push body when due rows exist", async () => {
    // Due rows, none first_seen today. Name always on (maxNewPerDay=10); reverse
    // capped to 0 so the estimate is deterministic (= 10 name headroom only).
    // Since name and reverse are always on since #1234, maxNewReversePerDay=0
    // isolates name-only headroom for a simpler assertion.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // 3 due + 10 new headroom (name only; reverse capped at 0) → combined copy.
    expect(parsed.body).toContain("3");
    expect(parsed.body).toContain("10");
    expect(parsed.body).toContain("new");
  });

  it("reduces the new-card estimate by rows already started today", async () => {
    // 5 name cards started today (first_seen = "2026-05-20"). Name estimate =
    // 10 - 5 = 5. Reverse is capped at 0 (maxNewReversePerDay=0) so only name
    // headroom contributes to the estimate, keeping the assertion deterministic.
    const today = "2026-05-20";
    const due: DueRow[] = [
      { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: today, locale: "en" },
      { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: today, locale: "en" },
      { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: today, locale: "en" },
      { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: today, locale: "en" },
      { user_id: "user-a", card_type: "name", subject_key: "5", first_seen: today, locale: "en" },
    ];
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // 5 due (all first_seen today = introduced today), name estimate = 5 (reverse capped at 0).
    // Pin the exact body string so both counts are asserted simultaneously —
    // a prior `toContain("5")` pair only proved the digit appeared once,
    // not that both quantities rendered correctly.
    expect(parsed.body).toBe("5 cards due plus 5 new ready to practise.");
  });

  it("clamps new-card estimate to 0 when daily cap already exhausted", async () => {
    // All 10 name slots and all 10 reverse slots already used today → estimate = 0.
    // Since name and reverse are always on since #1234, both caps must be exhausted
    // to drive newEstimate to 0.
    const today = "2026-05-20";
    const due: DueRow[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        user_id: "user-a",
        card_type: "name",
        subject_key: String(i + 1),
        first_seen: today,
        locale: "en",
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        user_id: "user-a",
        card_type: "reverse",
        subject_key: String(i + 1),
        first_seen: today,
        locale: "en",
      })),
    ];
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due,
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // dueCount = 20 (10 name + 10 reverse), newEstimate = 0 → due-only copy without "new".
    expect(parsed.body).toContain("20");
    expect(parsed.body).not.toContain("new");
  });

  // ─── #1501: evolution-bucket double-count fix ──────────────────────────────
  //
  // Forward-evolution and reverse-evolution cards share ONE `maxNewEvolutionPerDay`
  // bucket in `buildSessionQueues` (via `limitBucket`). `computeNewEstimate`
  // must mirror this by adding the cap at most once.

  it("both evolution directions enabled: evolution bucket counted once, not twice (#1501)", async () => {
    // Regression test for #1501. Confirmed production scenario:
    //   name=5, reverse=5, maxNewEvolutionPerDay=5, both evo directions on, cry off.
    // The real session delivers 5 + 5 + 5 = 15 new cards per day.
    // Before the fix, the notification reported 5 + 5 + 5 + 5 = 20.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 5,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 5,
          maxNewCryPerDay: 10,
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // name(5) + reverse(5) + evolution-bucket-once(5) = 15. Must NOT be 20.
    expect(parsed.body).toBe("15 new cards ready to practise.");
  });

  it("only forward evolution enabled: evolution bucket counted once", async () => {
    // Forward-only: evo term added once. name=0, reverse=0 to isolate.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 0,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // evolution bucket once = 5.
    expect(parsed.body).toBe("5 new cards ready to practise.");
  });

  it("only reverse-evolution enabled: evolution bucket still counted once", async () => {
    // Reverse-only: evo term added once. name=0, reverse=0 to isolate.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: true,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 0,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // evolution bucket once = 5.
    expect(parsed.body).toBe("5 new cards ready to practise.");
  });

  it("neither evolution direction enabled: no evolution term in estimate", async () => {
    // Both evo directions off. name=0, reverse=0, cry=0 → estimate = 0 → no notification.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 0,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);

    await POST(makeRequest());
    // No due rows and no new headroom → no notification sent.
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("name and reverse caps are independent: changing maxNewReversePerDay moves total independently", async () => {
    // Verify name and reverse remain separate buckets. With both evo directions
    // on and maxNewEvolutionPerDay=5, evo contributes 5. Set name=3, reverse=7
    // and verify the total is 3 + 7 + 5 = 15 (not 3 + 5 + 5 = 13 or any other
    // value that would imply name/reverse sharing).
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 3,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 7,
          maxNewCryPerDay: 10,
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // name(3) + reverse(7) + evo-bucket-once(5) = 15.
    expect(parsed.body).toBe("15 new cards ready to practise.");
  });
});

// ─── #1159: practice-scope filtering ─────────────────────────────────────────

describe("POST /api/push/send-daily — practice scope filtering (#1159)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("passes all cards when practiceScope is absent (empty scope default)", async () => {
    // No practiceScope in settings → defaults to EMPTY_SCOPE → all cards pass.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
          // no practiceScope key
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1",   first_seen: null, locale: "en" }, // Bulbasaur (Gen 1)
        { user_id: "user-a", card_type: "name", subject_key: "152", first_seen: null, locale: "en" }, // Chikorita (Gen 2)
        { user_id: "user-a", card_type: "name", subject_key: "252", first_seen: null, locale: "en" }, // Treecko (Gen 3)
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // All 3 cards pass (empty scope = no restriction).
    expect(parsed.body).toContain("3");
  });

  it("filters out cards outside the user's gens scope", async () => {
    // Scope: Gen 1 only. Chikorita (Gen 2) and Treecko (Gen 3) must be excluded.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
          practiceScope: {
            gens: [1],
            types: [],
            presets: [],
            formCategories: { mode: "all" },
            games: [],
          },
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1",   first_seen: null, locale: "en" }, // Bulbasaur (Gen 1) — kept
        { user_id: "user-a", card_type: "name", subject_key: "4",   first_seen: null, locale: "en" }, // Charmander (Gen 1) — kept
        { user_id: "user-a", card_type: "name", subject_key: "152", first_seen: null, locale: "en" }, // Chikorita (Gen 2) — excluded
        { user_id: "user-a", card_type: "name", subject_key: "252", first_seen: null, locale: "en" }, // Treecko (Gen 3) — excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only Gen 1 cards (ids 1 and 4) survive — due count = 2.
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("4 cards");
  });

  it("filters out cards outside the user's types scope", async () => {
    // Scope: Fire types only. Bulbasaur (Grass/Poison) must be excluded.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
          practiceScope: {
            gens: [],
            types: ["fire"],
            presets: [],
            formCategories: { mode: "all" },
            games: [],
          },
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" }, // Bulbasaur (Grass) — excluded
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "en" }, // Charmander (Fire) — kept
        { user_id: "user-a", card_type: "name", subject_key: "6", first_seen: null, locale: "en" }, // Charizard (Fire/Flying) — kept
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Charmander + Charizard pass; Bulbasaur is excluded.
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("3");
  });

  it("anchors evolution-edge scope check on the pre-evo (fromId)", async () => {
    // Evolution card Charmander(4)>>>Charmeleon(5): pre-evo = Charmander (Fire).
    // Fire scope → kept. Bulbasaur(1)>>>Ivysaur(2): pre-evo = Bulbasaur (Grass) → excluded.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
          practiceScope: {
            gens: [],
            types: ["fire"],
            presets: [],
            formCategories: { mode: "all" },
            games: [],
          },
        },
      }],
      due: [
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "4>>>5",   first_seen: null, locale: "en" }, // Charmander(Fire)→Charmeleon — kept
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "1>>>2",   first_seen: null, locale: "en" }, // Bulbasaur(Grass)→Ivysaur — excluded
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "5>>>6",   first_seen: null, locale: "en" }, // Charmeleon(Fire)→Charizard — kept
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Charmander→Charmeleon and Charmeleon→Charizard both pass; Bulbasaur→Ivysaur is excluded.
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("3");
  });

  it("filters out-of-scope due cards but preserves the new-card estimate", async () => {
    // Gen 1 scope but due rows are Gen 2. The scope filter removes them from
    // the due count (dueCount = 0). The new-card estimate is computed from the
    // daily-cap headroom for enabled directions — it cannot be scoped without
    // knowing which specific seed cards are in-scope and unseen, so the route
    // sends a "new cards ready" notification (the estimate reflects remaining
    // Gen-1 headroom even though the route does not compute it explicitly).
    // This is the accepted approximation documented in the issue (#1159):
    // the due count is now scope-accurate; the new-card estimate is cap-based.
    //
    // Reverse is always on since #1234. maxNewReversePerDay is set to 0 here
    // so the estimate is deterministic (= 10 name headroom only).
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 10,
          practiceScope: {
            gens: [1],
            types: [],
            presets: [],
            formCategories: { mode: "all" },
            games: [],
          },
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "152", first_seen: null, locale: "en" }, // Chikorita (Gen 2) — excluded
        { user_id: "user-a", card_type: "name", subject_key: "155", first_seen: null, locale: "en" }, // Cyndaquil (Gen 2) — excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number };
    // dueCount = 0 (Gen 2 rows excluded by scope); newEstimate = 10 (name headroom; reverse capped at 0).
    // The route still sends a notification for the new-card headroom.
    expect(body.sent).toBe(1);
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // dueCount=0, newEstimate=10 → new-only copy.
    expect(parsed.body).toContain("new");
    expect(parsed.body).toContain("10");
  });
});

// ─── #1315: per-user notification-hour gating ────────────────────────────────

describe("POST /api/push/send-daily — per-user notification-hour gate (#1315)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("NULL preference: notifies user when current UTC hour is 8 (default)", async () => {
    // Clock is pinned to 08:00 UTC by beforeEach. NULL preference → default UTC 8 → match.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: ALL_ENABLED_SETTINGS,
        push_notification_hour: null,
      }],
      due: dueRowsFor({ "user-a": 1 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
  });

  it("NULL preference: does NOT notify user when current UTC hour is not 8", async () => {
    // Override clock to 09:00 UTC — mismatches the default hour (8).
    vi.setSystemTime(new Date("2026-05-20T09:00:00Z"));
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: ALL_ENABLED_SETTINGS,
        push_notification_hour: null,
      }],
      due: dueRowsFor({ "user-a": 1 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    // Route should return 200 with sent=0 (no subscriptions matched the hour gate).
    expect(body.sent).toBe(0);
  });

  it("interim dormancy: user with non-default hour is NOT notified at 08:00 UTC", async () => {
    // Clock pinned to 08:00 UTC (beforeEach). User wants 20:00 UTC (hour=20).
    // 20 ≠ 8 → dormant during the interim daily cron.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: ALL_ENABLED_SETTINGS,
        push_notification_hour: 20,
      }],
      due: dueRowsFor({ "user-a": 3 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("set hour: notifies user when their local hour converts to the current UTC hour", async () => {
    // Clock at 08:00 UTC. User in Europe/London (BST = UTC+1) wants 09:00 local.
    // 09:00 BST = 08:00 UTC → match → should notify.
    vi.setSystemTime(new Date("2026-05-20T08:00:00Z")); // BST day
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "Europe/London",
        settings: ALL_ENABLED_SETTINGS,
        push_notification_hour: 9, // 09:00 local in BST = 08:00 UTC
      }],
      due: dueRowsFor({ "user-a": 2 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    expect(body.sent).toBe(1);
  });

  it("returns ok:true with sent=0 when no subscriptions match the UTC hour", async () => {
    // Clock at 08:00 UTC. Both users have non-matching hours.
    const admin = buildAdminMock({
      subscriptions: [
        SUB,
        { id: "sub-2", user_id: "user-b", endpoint: "https://push.example/b", p256dh: "p256-b", auth_secret: "auth-b" },
      ],
      settings: [
        { user_id: "user-a", timezone: "UTC", settings: ALL_ENABLED_SETTINGS, push_notification_hour: 20 },
        { user_id: "user-b", timezone: "UTC", settings: ALL_ENABLED_SETTINGS, push_notification_hour: 18 },
      ],
      due: dueRowsFor({ "user-a": 5, "user-b": 3 }),
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number; deleted: number };
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(0);
    expect(body.deleted).toBe(0);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

// ─── #1480: pokemonNameLocale due-count filtering ────────────────────────────

describe("POST /api/push/send-daily — pokemonNameLocale locale filter (#1480)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("en-only user: all en rows counted, due count unchanged", async () => {
    // A user who has only ever practised in English. Their pokemonNameLocale
    // is "en" (either set explicitly or absent — both default to "en"). All
    // card_reviews rows have locale="en" (migration 029 backfill). No inflation.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          pokemonNameLocale: "en",
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "7", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // All 3 en rows pass for an en user — count is 3, not inflated.
    expect(parsed.body).toContain("3");
    expect(parsed.body).not.toContain("6");
  });

  it("multi-locale user (en + ja): only active-locale (ja) rows counted", async () => {
    // This is the core bug scenario (#1480). A user who has practised in both
    // English and Japanese has independent FSRS rows per locale. Their current
    // active pokemonNameLocale is "ja". The route must count only the ja rows
    // (25 in this example) and exclude the en rows (25), producing "25 cards
    // due" rather than "50 cards due".
    const jaDue: DueRow[] = Array.from({ length: 25 }, (_, i) => ({
      user_id: "user-a",
      card_type: "name",
      subject_key: String(i + 1),
      first_seen: null,
      locale: "ja",
    }));
    const enDue: DueRow[] = Array.from({ length: 25 }, (_, i) => ({
      user_id: "user-a",
      card_type: "name",
      subject_key: String(i + 1),
      first_seen: null,
      locale: "en",
    }));
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          pokemonNameLocale: "ja",
        },
      }],
      // DB returns both locale sets; route must filter client-side.
      due: [...jaDue, ...enDue],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only the 25 ja rows pass — not the inflated 50.
    expect(parsed.body).toContain("25");
    expect(parsed.body).not.toContain("50");
  });

  it("never-set-locale user (absent JSONB key): defaults to en, counts en backfilled rows", async () => {
    // A user whose settings JSONB has no pokemonNameLocale key at all (pre-#1260
    // record). parseEligibility falls back to DEFAULT_ELIGIBILITY.pokemonNameLocale
    // = "en". Migration 029 backfilled all their card_reviews rows to locale="en".
    // They must still see the correct count.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
          // pokemonNameLocale deliberately absent — tests the default fallback
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Both en rows pass for the default-en user.
    expect(parsed.body).toContain("2");
  });

  it("user with no settings row: defaults to en, counts en rows", async () => {
    // A user who has push_subscriptions but no user_settings row at all.
    // The route falls back to DEFAULT_ELIGIBILITY (pokemonNameLocale = "en").
    // Their legacy backfilled rows (locale="en") must still be counted.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [], // no user_settings row for this user
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "7", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // All 3 en rows pass — DEFAULT_ELIGIBILITY uses "en".
    expect(parsed.body).toContain("3");
  });

  it("invalid/unknown pokemonNameLocale in JSONB: falls back to en", async () => {
    // An unknown locale value (e.g. "zh-CN" or "fr") must not crash and must
    // fall back to "en", matching the validation in lib/settings/persistence.ts.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          pokemonNameLocale: "zh-CN", // invalid — not one of the four accepted values
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Falls back to "en"; both en rows pass.
    expect(parsed.body).toContain("2");
  });

  it("zh-Hans user: only zh-Hans rows counted; en rows excluded", async () => {
    // Ensures the fix works for the zh-Hans locale (note: exact casing matters —
    // DB CHECK constraint and app validator both use "zh-Hans", not "zh-CN").
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          pokemonNameLocale: "zh-Hans",
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "zh-Hans" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "zh-Hans" },
        { user_id: "user-a", card_type: "name", subject_key: "7", first_seen: null, locale: "en" }, // excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only 2 zh-Hans rows pass (not 3). The body starts with "2 cards due" in
    // the combined form (dueCount=2 plus new-card estimate from caps). Assert
    // the due count specifically rather than a bare digit to avoid false
    // failures from the new-card estimate containing "3" as a substring.
    expect(parsed.body).toMatch(/^2 cards? due/);
    expect(parsed.body).not.toMatch(/^3 cards? due/);
  });

  it("zh-Hant user: only zh-Hant rows counted; other locale rows excluded", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          pokemonNameLocale: "zh-Hant",
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "zh-Hant" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "zh-Hant" },
        { user_id: "user-a", card_type: "name", subject_key: "7", first_seen: null, locale: "zh-Hans" }, // excluded
        { user_id: "user-a", card_type: "name", subject_key: "10", first_seen: null, locale: "en" },    // excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only 2 zh-Hant rows pass; the body must not report 4 cards due.
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("4 card");
  });

  it("two users each with different locales in the same timezone bucket: each sees only their locale rows", async () => {
    // Both users are in UTC (same timezone bucket) so their rows are returned
    // in a single query. The per-user client-side filter must scope correctly
    // to each user's own pokemonNameLocale independently.
    //
    // user-a: pokemonNameLocale="en", has 3 en + 3 ja rows → due = 3
    // user-b: pokemonNameLocale="ja", has 3 en + 3 ja rows → due = 3
    const admin = buildAdminMock({
      subscriptions: [
        SUB,
        { id: "sub-2", user_id: "user-b", endpoint: "https://push.example/b", p256dh: "p256-b", auth_secret: "auth-b" },
      ],
      settings: [
        { user_id: "user-a", timezone: "UTC", settings: { ...ALL_ENABLED_SETTINGS, pokemonNameLocale: "en" } },
        { user_id: "user-b", timezone: "UTC", settings: { ...ALL_ENABLED_SETTINGS, pokemonNameLocale: "ja" } },
      ],
      due: [
        // user-a: 3 en (match) + 3 ja (skip)
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "ja" },
        // user-b: 3 en (skip) + 3 ja (match)
        { user_id: "user-b", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-b", card_type: "name", subject_key: "2", first_seen: null, locale: "en" },
        { user_id: "user-b", card_type: "name", subject_key: "3", first_seen: null, locale: "en" },
        { user_id: "user-b", card_type: "name", subject_key: "1", first_seen: null, locale: "ja" },
        { user_id: "user-b", card_type: "name", subject_key: "2", first_seen: null, locale: "ja" },
        { user_id: "user-b", card_type: "name", subject_key: "3", first_seen: null, locale: "ja" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const res = await POST(makeRequest());
    const body = (await res.json()) as { sent: number };
    // Both users have 3 due cards in their active locale → 2 notifications sent.
    expect(body.sent).toBe(2);
    // Each push payload must contain "3", not "6" (which would indicate no locale filter).
    for (const call of mockSendNotification.mock.calls) {
      const parsed = JSON.parse(call[1] as string) as { body: string };
      expect(parsed.body).toContain("3");
      expect(parsed.body).not.toContain("6");
    }
  });
});
