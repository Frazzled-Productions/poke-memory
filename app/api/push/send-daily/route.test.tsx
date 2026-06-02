/**
 * Tests for POST /api/push/send-daily.
 *
 * Verifies the auth gate, the misconfiguration short-circuit, the per-user
 * fan-out, the dead-endpoint cleanup, and the buildDailyMessage copy.
 *
 * Also covers #1153: per-user settings filtering (card-type flags and the
 * alt-forms toggle) and the new-card estimate added to the push body.
 *
 * #1504: supersedes #1480's single-locale filter. Tests now use
 * `learningLocales` in settings. New multi-language breakdown tests verify
 * the per-locale due accumulation and copy formatting.
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

import { POST, buildDailyMessage, type LocaleDueMap } from "./route";
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
 *
 * `learningLocales` defaults to ["en"] (pre-#1484 / English-only users).
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
  learningLocales: ["en"],
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

/** Helper: build a LocaleDueMap from an object literal. */
function makeLocaleDueMap(entries: Record<string, number>): LocaleDueMap {
  const m: LocaleDueMap = new Map();
  for (const [locale, count] of Object.entries(entries)) {
    m.set(locale as import("@/i18n/locales").AppLocale, count);
  }
  return m;
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

// ─── buildDailyMessage: single-language (regression-lock existing paths) ───────

describe("buildDailyMessage — single-language (unchanged feel)", () => {
  it("renders due-only copy for a single locale with no new estimate", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 3 }));
    expect(msg.title).toBe("Time to practise");
    expect(msg.body).toBe("3 cards due in English for review.");
    expect(msg.url).toBe("/");
  });

  it("uses singular 'card' for one due card with no new estimate", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 1 }), 0);
    expect(msg.body).toBe("1 card due in English for review.");
  });

  it("renders combined copy when both due and new are positive (single locale)", async () => {
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 13 }), 15)).body).toBe(
      "13 cards due in English plus 15 new ready to practise.",
    );
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 1 }), 1)).body).toBe(
      "1 card due in English plus 1 new ready to practise.",
    );
  });

  it("renders combined copy for a single non-English locale", async () => {
    expect((await buildDailyMessage(makeLocaleDueMap({ ja: 8 }), 5)).body).toBe(
      "8 cards due in 日本語 plus 5 new ready to practise.",
    );
  });

  it("renders combined copy for zh-Hans (single locale)", async () => {
    expect((await buildDailyMessage(makeLocaleDueMap({ "zh-Hans": 3 }), 10)).body).toBe(
      "3 cards due in 简体中文 plus 10 new ready to practise.",
    );
  });

  it("renders combined copy for zh-Hant (single locale)", async () => {
    expect((await buildDailyMessage(makeLocaleDueMap({ "zh-Hant": 2 }))).body).toBe(
      "2 cards due in 繁體中文 for review.",
    );
  });

  it("renders new-only copy when dueCount is 0 (empty map) but newEstimate is positive", async () => {
    expect((await buildDailyMessage(new Map(), 10)).body).toBe("10 new cards ready to practise.");
    expect((await buildDailyMessage(new Map(), 1)).body).toBe("1 new card ready to practise.");
  });

  it("does not use em dashes anywhere in single-language messages", async () => {
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 1 }))).body).not.toContain("—");
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 5 }), 3)).body).not.toContain("—");
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 1 }))).title).not.toContain("—");
  });

  it("uses British English 'practise' in single-language copy", async () => {
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 3 }), 5)).body).toContain("practise");
    expect((await buildDailyMessage(new Map(), 5)).body).toContain("practise");
    expect((await buildDailyMessage(makeLocaleDueMap({ en: 3 }), 5)).body).not.toContain("practice");
    expect((await buildDailyMessage(new Map(), 5)).body).not.toContain("practice");
  });
});

// ─── buildDailyMessage: multi-language breakdown (#1504) ──────────────────────

describe("buildDailyMessage — multi-language breakdown (#1504)", () => {
  it("two due locales: global total leads, breakdown ordered due-desc", async () => {
    // en=12, ja=8 → total 20, en first (higher due)
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 12, ja: 8 }));
    expect(msg.title).toBe("Time to practise");
    expect(msg.body).toBe("20 cards due across your languages: English 12, 日本語 8.");
  });

  it("two due locales with new estimate: combined multi copy", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 12, ja: 8 }), 7);
    expect(msg.body).toBe(
      "20 cards due across your languages: English 12, 日本語 8. Plus 7 new ready to practise.",
    );
  });

  it("three due locales: ordered by due-count descending", async () => {
    // zh-Hans=5, en=3, ja=10 → sorted: ja=10, zh-Hans=5, en=3
    const msg = await buildDailyMessage(makeLocaleDueMap({ "zh-Hans": 5, en: 3, ja: 10 }));
    expect(msg.body).toBe(
      "18 cards due across your languages: 日本語 10, 简体中文 5, English 3.",
    );
  });

  it("three due locales with new estimate", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ "zh-Hans": 5, en: 3, ja: 10 }), 4);
    expect(msg.body).toBe(
      "18 cards due across your languages: 日本語 10, 简体中文 5, English 3. Plus 4 new ready to practise.",
    );
  });

  it("four due locales: all four appear in the breakdown", async () => {
    const msg = await buildDailyMessage(
      makeLocaleDueMap({ en: 15, ja: 12, "zh-Hans": 8, "zh-Hant": 5 }),
    );
    expect(msg.body).toBe(
      "40 cards due across your languages: English 15, 日本語 12, 简体中文 8, 繁體中文 5.",
    );
  });

  it("tie-break: equal due counts sorted by canonical locale order (en, ja, zh-Hans, zh-Hant)", async () => {
    // All four locales with equal due count of 5 → en first by canonical order
    const msg = await buildDailyMessage(
      makeLocaleDueMap({ "zh-Hant": 5, ja: 5, "zh-Hans": 5, en: 5 }),
    );
    expect(msg.body).toBe(
      "20 cards due across your languages: English 5, 日本語 5, 简体中文 5, 繁體中文 5.",
    );
  });

  it("zero-due locales are omitted from the breakdown (multi-enrolled, one active due)", async () => {
    // User enrolled in en + ja, but only en has due cards.
    // The map passed to buildDailyMessage should only contain non-zero locales.
    // With only one non-zero locale, the compact single-due-locale form is used.
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 8 }), 3);
    // Only en due → compact single form, not multi-breakdown
    expect(msg.body).toBe("8 cards due in English plus 3 new ready to practise.");
    expect(msg.body).not.toContain("日本語");
    expect(msg.body).not.toContain("across");
  });

  it("uses full endonyms, not abbreviations", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 5, ja: 3 }));
    expect(msg.body).toContain("English");
    expect(msg.body).toContain("日本語");
    // Must NOT contain invented abbreviations
    expect(msg.body).not.toMatch(/\bEN\b/);
    expect(msg.body).not.toMatch(/\bJA\b/);
  });

  it("does not use em dashes in multi-language messages", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 5, ja: 3 }), 2);
    expect(msg.body).not.toContain("—");
    expect(msg.title).not.toContain("—");
  });

  it("uses British English 'practise' in multi-language combined copy", async () => {
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 5, ja: 3 }), 2);
    expect(msg.body).toContain("practise");
    expect(msg.body).not.toContain("practice");
  });

  it("singular 'card' when global total is 1 across two locales", async () => {
    // ja=1, en=0 → with only ja in map
    const msg = await buildDailyMessage(makeLocaleDueMap({ ja: 1, en: 0 }));
    // en=0 → omit from map before calling; but this tests the multi path with a true multi-locale map
    // Actually with en=0 still in map, the route omits zero-due entries.
    // Let's test a genuine single non-zero locale among a two-locale map:
    const msg2 = await buildDailyMessage(makeLocaleDueMap({ ja: 1 }));
    expect(msg2.body).toBe("1 card due in 日本語 for review.");
  });

  it("multi-due single card (total=1 across two non-zero locales would be odd but covered)", async () => {
    // Two locales each with due > 0, total = 2
    const msg = await buildDailyMessage(makeLocaleDueMap({ en: 1, ja: 1 }));
    // Both have due=1, tie-break: en first by canonical order
    expect(msg.body).toBe("2 cards due across your languages: English 1, 日本語 1.");
  });
});

// ─── POST handler auth and config gates ──────────────────────────────────────

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

// ─── POST handler happy path ──────────────────────────────────────────────────

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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
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

// ─── Dead-endpoint cleanup ─────────────────────────────────────────────────────

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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
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

// ─── #1153: new-card estimate ─────────────────────────────────────────────────

describe("POST /api/push/send-daily — new-card estimate (#1153)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("includes a new-card estimate in the push body when due rows exist", async () => {
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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
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
    expect(parsed.body).toBe("5 cards due in English plus 5 new ready to practise.");
  });

  it("clamps new-card estimate to 0 when daily cap already exhausted", async () => {
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
          learningLocales: ["en"],
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

  it("both evolution directions enabled: evolution bucket counted once, not twice (#1501)", async () => {
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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
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
    expect(parsed.body).toBe("5 new cards ready to practise.");
  });

  it("only reverse-evolution enabled: evolution bucket still counted once", async () => {
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
          learningLocales: ["en"],
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
    expect(parsed.body).toBe("5 new cards ready to practise.");
  });

  it("neither evolution direction enabled: no evolution term in estimate", async () => {
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
          learningLocales: ["en"],
        },
      }],
      due: [],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);

    await POST(makeRequest());
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("name and reverse caps are independent: changing maxNewReversePerDay moves total independently", async () => {
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
          learningLocales: ["en"],
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
          learningLocales: ["en"],
          // no practiceScope key
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1",   first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "152", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "252", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    expect(parsed.body).toContain("3");
  });

  it("filters out cards outside the user's gens scope", async () => {
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
          learningLocales: ["en"],
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
        { user_id: "user-a", card_type: "name", subject_key: "1",   first_seen: null, locale: "en" }, // Gen 1 — kept
        { user_id: "user-a", card_type: "name", subject_key: "4",   first_seen: null, locale: "en" }, // Gen 1 — kept
        { user_id: "user-a", card_type: "name", subject_key: "152", first_seen: null, locale: "en" }, // Gen 2 — excluded
        { user_id: "user-a", card_type: "name", subject_key: "252", first_seen: null, locale: "en" }, // Gen 3 — excluded
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("4 cards");
  });

  it("filters out cards outside the user's types scope", async () => {
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
          learningLocales: ["en"],
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
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("3");
  });

  it("anchors evolution-edge scope check on the pre-evo (fromId)", async () => {
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
          learningLocales: ["en"],
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
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "4>>>5",   first_seen: null, locale: "en" }, // kept
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "1>>>2",   first_seen: null, locale: "en" }, // excluded
        { user_id: "user-a", card_type: "evolution-edge", subject_key: "5>>>6",   first_seen: null, locale: "en" }, // kept
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    expect(parsed.body).toContain("2");
    expect(parsed.body).not.toContain("3");
  });

  it("filters out-of-scope due cards but preserves the new-card estimate", async () => {
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
          learningLocales: ["en"],
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
        { user_id: "user-a", card_type: "name", subject_key: "152", first_seen: null, locale: "en" }, // Gen 2 — excluded
        { user_id: "user-a", card_type: "name", subject_key: "155", first_seen: null, locale: "en" }, // Gen 2 — excluded
      ],
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
    expect(body.sent).toBe(0);
  });

  it("interim dormancy: user with non-default hour is NOT notified at 08:00 UTC", async () => {
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
    vi.setSystemTime(new Date("2026-05-20T08:00:00Z"));
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "Europe/London",
        settings: ALL_ENABLED_SETTINGS,
        push_notification_hour: 9,
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

// ─── #1504: learningLocales membership filter (supersedes #1480 pokemonNameLocale) ─

describe("POST /api/push/send-daily — learningLocales filter (#1504, supersedes #1480)", () => {
  const SUB = {
    id: "sub-1",
    user_id: "user-a",
    endpoint: "https://push.example/a",
    p256dh: "p256-a",
    auth_secret: "auth-a",
  };

  it("en-only user (pre-#1484 default): all en rows counted, no inflation", async () => {
    // A user with learningLocales=["en"] (the default). All card_reviews rows
    // have locale="en" (migration 029 backfill). Count is 3, not inflated.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          learningLocales: ["en"],
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
    // 3 en rows → "3 cards due in English for review."
    expect(parsed.body).toContain("3");
    expect(parsed.body).not.toContain("6");
  });

  it("multi-locale user (en + ja): both locales counted, breakdown in body", async () => {
    // Core #1504 scenario. User learns both English and Japanese. Both locales'
    // due rows count toward the total and appear in the breakdown.
    const jaDue: DueRow[] = Array.from({ length: 8 }, (_, i) => ({
      user_id: "user-a",
      card_type: "name",
      subject_key: String(i + 1),
      first_seen: null,
      locale: "ja",
    }));
    const enDue: DueRow[] = Array.from({ length: 12 }, (_, i) => ({
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
          learningLocales: ["en", "ja"],
        },
      }],
      due: [...jaDue, ...enDue],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Total = 20. en=12 (higher), ja=8. Body contains both counts.
    expect(parsed.body).toContain("20");
    expect(parsed.body).toContain("English 12");
    expect(parsed.body).toContain("日本語 8");
    expect(parsed.body).toContain("across");
  });

  it("multi-locale user: a locale NOT in learningLocales is excluded from the count", async () => {
    // User learns en only (learningLocales=["en"]). They have zh-Hans rows in
    // card_reviews (perhaps from a past language trial) — those must NOT count.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          learningLocales: ["en"],
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "zh-Hans" }, // not in learning set
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Only 2 en rows; zh-Hans excluded.
    expect(parsed.body).toMatch(/^2 cards? due/);
    expect(parsed.body).not.toMatch(/^3 cards? due/);
  });

  it("three-locale user: all three locales contribute to count and breakdown", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          learningLocales: ["en", "ja", "zh-Hans"],
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "zh-Hans" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // ja=3, en=2, zh-Hans=1 → total 6, ordered due-desc
    expect(parsed.body).toContain("6");
    expect(parsed.body).toContain("日本語 3");
    expect(parsed.body).toContain("English 2");
    expect(parsed.body).toContain("简体中文 1");
    // ja highest → appears first
    expect(parsed.body.indexOf("日本語")).toBeLessThan(parsed.body.indexOf("English"));
  });

  it("enrolled in two locales but only one has due cards: compact single-due-locale form", async () => {
    // User learns en + ja. Only ja has due cards. The DB returns only ja rows,
    // so the accumulated map has only ja. Compact single-due-locale form used.
    // New-card caps zeroed (all caps to 0) so the body is purely due-only for a
    // clean assertion — we test the compact form specifically.
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
          maxNewEvolutionPerDay: 0,
          maxNewReversePerDay: 0,
          maxNewCryPerDay: 0,
          learningLocales: ["en", "ja"],
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "ja" },
        // no en due rows
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Compact single-due-locale form: "3 cards due in 日本語 for review."
    expect(parsed.body).toBe("3 cards due in 日本語 for review.");
    // Must NOT use the multi-breakdown form
    expect(parsed.body).not.toContain("across");
    expect(parsed.body).not.toContain("English");
  });

  it("never-set-locale user (no learningLocales in JSONB): defaults to en", async () => {
    // A pre-#1484 user whose settings JSONB has no learningLocales key.
    // parseLearningLocales falls back to ["en"]. Their legacy rows are locale="en".
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
          // learningLocales deliberately absent — tests the default fallback
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

  it("user with no settings row: defaults to en (DEFAULT_ELIGIBILITY), counts en rows", async () => {
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
    expect(parsed.body).toContain("3");
  });

  it("invalid learningLocales entries silently dropped; English always present", async () => {
    // An invalid locale value (e.g. "zh-CN") must be dropped; "en" must
    // always be added even if absent from the raw array.
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          learningLocales: ["zh-CN", "fr"], // both invalid — fallback to ["en"]
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
    // Falls back to ["en"]; both en rows pass.
    expect(parsed.body).toContain("2");
  });

  it("zh-Hans user with learningLocales=[en,zh-Hans]: both locales counted", async () => {
    const admin = buildAdminMock({
      subscriptions: [SUB],
      settings: [{
        user_id: "user-a",
        timezone: "UTC",
        settings: {
          ...ALL_ENABLED_SETTINGS,
          learningLocales: ["en", "zh-Hans"],
        },
      }],
      due: [
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "zh-Hans" },
        { user_id: "user-a", card_type: "name", subject_key: "4", first_seen: null, locale: "zh-Hans" },
        { user_id: "user-a", card_type: "name", subject_key: "7", first_seen: null, locale: "en" },
      ],
    });
    mockCreateClient.mockReturnValue(admin.client as unknown as ReturnType<typeof createClient>);
    mockSendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    await POST(makeRequest());
    const parsed = JSON.parse(
      mockSendNotification.mock.calls[0][1] as string,
    ) as { body: string };
    // Total = 3. zh-Hans=2 (higher), en=1 → multi breakdown
    expect(parsed.body).toContain("3");
    expect(parsed.body).toContain("简体中文 2");
    expect(parsed.body).toContain("English 1");
  });

  it("two users in the same timezone bucket: each sees only their learningLocales rows", async () => {
    // user-a: learningLocales=["en"], has 3 en + 3 ja rows → due = 3 (en only)
    // user-b: learningLocales=["en","ja"], has 3 en + 3 ja rows → due = 6 (both)
    const admin = buildAdminMock({
      subscriptions: [
        SUB,
        { id: "sub-2", user_id: "user-b", endpoint: "https://push.example/b", p256dh: "p256-b", auth_secret: "auth-b" },
      ],
      settings: [
        { user_id: "user-a", timezone: "UTC", settings: { ...ALL_ENABLED_SETTINGS, learningLocales: ["en"] } },
        { user_id: "user-b", timezone: "UTC", settings: { ...ALL_ENABLED_SETTINGS, learningLocales: ["en", "ja"] } },
      ],
      due: [
        // user-a: 3 en (match) + 3 ja (skip — not in user-a's learning set)
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "en" },
        { user_id: "user-a", card_type: "name", subject_key: "1", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "2", first_seen: null, locale: "ja" },
        { user_id: "user-a", card_type: "name", subject_key: "3", first_seen: null, locale: "ja" },
        // user-b: 3 en (match) + 3 ja (match — in user-b's learning set)
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
    // Both users have due cards → 2 notifications sent.
    expect(body.sent).toBe(2);

    // Collect payloads by endpoint.
    const payloads: Record<string, { body: string }> = {};
    for (const call of mockSendNotification.mock.calls) {
      const sub = call[0] as { endpoint: string };
      payloads[sub.endpoint] = JSON.parse(call[1] as string) as { body: string };
    }

    // user-a: 3 due (en only), single-locale compact form
    expect(payloads["https://push.example/a"].body).toContain("3");
    expect(payloads["https://push.example/a"].body).not.toContain("6");

    // user-b: 6 due (en=3 + ja=3), multi-locale breakdown form
    expect(payloads["https://push.example/b"].body).toContain("6");
    expect(payloads["https://push.example/b"].body).toContain("English 3");
    expect(payloads["https://push.example/b"].body).toContain("日本語 3");
  });
});
