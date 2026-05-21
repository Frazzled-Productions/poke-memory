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

/** Shape the route now reads from card_reviews. */
type DueRow = {
  user_id: string;
  card_type: string;
  subject_key: string;
  first_seen: string | null;
};

/** Shape the route reads from user_settings. */
type SettingsMockRow = {
  user_id: string;
  timezone: string | null;
  settings?: Record<string, unknown> | null;
};

/**
 * All-enabled settings JSONB that matches DEFAULT_SETTINGS. Used when a test
 * just needs "every card type on" without caring about the specific values.
 */
const ALL_ENABLED_SETTINGS: Record<string, unknown> = {
  nameCardsEnabled: true,
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: true,
  reverseCardsEnabled: true,
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
 * `{ user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null }`
 * rows in `due`. The helpers `dueRowsFor` / `dueRowsDetailed` build them.
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
 * sequential subject_key, first_seen=null (not started today). Use this
 * for tests that just need N due cards without caring about card type or
 * alt-forms.
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
      // All card types disabled → no due cards, no new estimate.
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: false,
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: false,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
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
    // No due rows. Only name cards enabled, maxNewPerDay=10, no first_seen=today
    // rows → estimate = 10 (name headroom). Other card types explicitly off so
    // the estimate is deterministic.
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
          nameCardsEnabled: true,
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
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
    // dueCount = 0, newEstimate = 10 → new-only copy.
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
        { user_id: "user-a", card_type: "name",                   subject_key: "1",   first_seen: null },
        { user_id: "user-a", card_type: "reverse",                subject_key: "1",   first_seen: null },
        { user_id: "user-a", card_type: "evolution-edge",         subject_key: "1>>>2", first_seen: null },
        { user_id: "user-a", card_type: "reverse-evolution-edge", subject_key: "1>>>2", first_seen: null },
        { user_id: "user-a", card_type: "cry",                    subject_key: "1",   first_seen: null },
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

  it("reverseCardsEnabled: false — excludes reverse card rows from due count", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: true,
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          reverseCardsEnabled: false, // ← off
          cryCardsEnabled: true,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name",    subject_key: "1", first_seen: null },
        { user_id: "user-a", card_type: "reverse",  subject_key: "1", first_seen: null }, // excluded
        { user_id: "user-a", card_type: "reverse",  subject_key: "2", first_seen: null }, // excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only 1 name card eligible; the 2 reverse cards are filtered out.
    // The body starts with "1 card due" — use startsWith so the new-estimate
    // portion of the combined copy does not interfere with the assertion.
    expect(parsed.body.startsWith("1 card due")).toBe(true);
  });

  it("alternateFormsEnabled: false — excludes name/reverse/cry rows with species id >= 10000", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: true,
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: false, // ← alt-forms off
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "25",    first_seen: null }, // Pikachu — kept
        { user_id: "user-a", card_type: "name", subject_key: "10004", first_seen: null }, // alt-form — excluded
        { user_id: "user-a", card_type: "name", subject_key: "10098", first_seen: null }, // alt-form — excluded
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
          nameCardsEnabled: false,
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: false, // ← alt-forms off
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "133>>>134",     first_seen: null }, // Eevee→Vaporeon — kept
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "10027>>>10028", first_seen: null }, // alt-form — excluded
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "26>>>10023",    first_seen: null }, // post-evo alt-form — excluded
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

  it("combined: reverseCardsEnabled off + alternateFormsEnabled off — reproduces the #1153 scenario", async () => {
    // Mirrors the observed production data: 8 name rows (3 default + 5 alt),
    // 6 reverse rows (5 default + 1 alt), 4 evolution-edge, 1 reverse-evo-edge.
    // With reverse off and alt-forms off, expected due count = 3 (name default only).
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: true,
          evolutionCardsEnabled: true,
          reverseEvolutionCardsEnabled: true,
          reverseCardsEnabled: false,     // ← off
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
        { user_id: "user-a", card_type: "name", subject_key: "1",  first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "4",  first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "7",  first_seen: null },
        // 5 name alt-form (excluded by alt-forms gate)
        { user_id: "user-a", card_type: "name", subject_key: "10004",  first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "10098",  first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "10116",  first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "10123",  first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "10176",  first_seen: null },
        // 6 reverse rows (excluded by reverseCardsEnabled: false)
        { user_id: "user-a", card_type: "reverse", subject_key: "25",  first_seen: null },
        { user_id: "user-a", card_type: "reverse", subject_key: "26",  first_seen: null },
        { user_id: "user-a", card_type: "reverse", subject_key: "27",  first_seen: null },
        { user_id: "user-a", card_type: "reverse", subject_key: "28",  first_seen: null },
        { user_id: "user-a", card_type: "reverse", subject_key: "29",  first_seen: null },
        { user_id: "user-a", card_type: "reverse", subject_key: "10027", first_seen: null },
        // 4 evolution-edge (default ids — all pass)
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "1>>>2",   first_seen: null },
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "2>>>3",   first_seen: null },
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "4>>>5",   first_seen: null },
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "5>>>6",   first_seen: null },
        // 1 reverse-evolution-edge (default ids — passes)
        { user_id: "user-a", card_type: "reverse-evolution-edge", subject_key: "4>>>5", first_seen: null },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // 3 name (default) + 4 evolution-edge + 1 reverse-evolution-edge = 8 due.
    // The push body must contain "8" and not "19" (the raw pre-filter count).
    expect(parsed.body).toContain("8");
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
    // Due rows, none first_seen today → maxNewPerDay (10) headroom remains.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: true,
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 5,
          maxNewReversePerDay: 10,
          maxNewCryPerDay: 10,
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // 3 due + 10 new headroom → combined copy.
    expect(parsed.body).toContain("3");
    expect(parsed.body).toContain("10");
    expect(parsed.body).toContain("new");
  });

  it("reduces the new-card estimate by rows already started today", async () => {
    // 5 cards started today (first_seen = "2026-05-20") → estimate = 10 - 5 = 5.
    const today = "2026-05-20";
    const due: DueRow[] = [
      { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: today },
      { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: today },
      { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: today },
      { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: today },
      { user_id: "user-a", card_type: "name", subject_key: "5", first_seen: today },
    ];
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: true,
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
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
    // 5 due (all first_seen today = due cards introduced today), estimate = 5.
    // Pin the exact body string so both counts are asserted simultaneously —
    // a prior `toContain("5")` pair only proved the digit appeared once,
    // not that both quantities rendered correctly.
    expect(parsed.body).toBe("5 cards due plus 5 new ready to practise.");
  });

  it("clamps new-card estimate to 0 when daily cap already exhausted", async () => {
    // All 10 new-card slots already used today → estimate = 0.
    const today = "2026-05-20";
    const due: DueRow[] = Array.from({ length: 10 }, (_, i) => ({
      user_id: "user-a",
      card_type: "name",
      subject_key: String(i + 1),
      first_seen: today,
    }));
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: true,
          evolutionCardsEnabled: false,
          reverseEvolutionCardsEnabled: false,
          reverseCardsEnabled: false,
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
    // dueCount = 10, newEstimate = 0 → due-only copy without "new".
    expect(parsed.body).toContain("10");
    expect(parsed.body).not.toContain("new");
  });

  it("dual-evolution directions double-draw maxNewEvolutionPerDay (#1156)", async () => {
    // When both evolutionCardsEnabled and reverseEvolutionCardsEnabled are on,
    // computeNewEstimate sums the cap for each direction independently. The
    // source comment on computeNewEstimate flags this as a deliberate
    // simplification: the actual session cap is shared between the two
    // directions but the push estimate doubles it. This test pins that
    // behaviour so a future refactor that "fixes" the over-count does so
    // intentionally rather than by accident.
    //
    // Distinct fixture values chosen so the doubled estimate (7 + 7 = 14)
    // cannot collide with any other cap in the settings blob (maxNewPerDay,
    // maxNewReversePerDay, maxNewCryPerDay all differ from 7 and 14).
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          nameCardsEnabled: false,
          evolutionCardsEnabled: true,         // draws maxNewEvolutionPerDay
          reverseEvolutionCardsEnabled: true,  // draws maxNewEvolutionPerDay again
          reverseCardsEnabled: false,
          cryCardsEnabled: false,
          alternateFormsEnabled: true,
          maxNewPerDay: 10,
          maxNewEvolutionPerDay: 7,
          maxNewReversePerDay: 11,
          maxNewCryPerDay: 13,
        },
      }],
      // No due rows at all → dueCount = 0, body uses the new-only copy.
      // No first_seen-today rows → both directions retain full headroom.
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // 7 (evolution) + 7 (reverse-evolution) = 14, even though the real
    // session cap on evolution-direction cards is shared.
    expect(parsed.body).toBe("14 new cards ready to practise.");
  });
});
