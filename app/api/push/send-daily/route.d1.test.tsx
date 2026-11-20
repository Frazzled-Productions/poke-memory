/**
 * POST /api/push/send-daily end to end on the D1 test database: the real
 * lib/db/system queries, several time zones and a DST boundary for the
 * per-user hour gate and the local "today", the outbound gate (design D2)
 * and two users' rows kept apart. `web-push` is mocked: nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

import webpush from "web-push";
import { POST } from "./route";
import { forUser } from "@/lib/db/scope";
import { getPushTargets } from "@/lib/db/system";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";

const send = vi.mocked(webpush.sendNotification);
const setVapid = vi.mocked(webpush.setVapidDetails);

let d1: SqliteD1;
let env: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  d1 = createSqliteD1();
  env = {
    DB: d1,
    DEPLOY_ENV: "cloudflare-production",
    CRON_SHARED_SECRET: "secret-value",
    VAPID_PRIVATE_KEY: "vapid-priv",
    VAPID_SUBJECT: "mailto:test@example.com",
  };
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "vapid-pub";
  getCloudflareContext.mockImplementation(async () => ({ env }));
  send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  d1.close();
});

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

const request = () =>
  new Request("http://localhost/api/push/send-daily", {
    method: "POST",
    headers: { Authorization: "Bearer secret-value" },
  });

/** A subscribed user with settings and `due` name cards due on `dueDate`. */
async function player(name: string, settings: { timezone: string | null; hour: number | null }, due: number, dueDate: string) {
  const id = createTestUser(d1, { username: name });
  const db = forUser(d1, id);
  await db.insert("user_settings", {
    settings: { learningLocales: ["en"], maxNewPerDay: 0, maxNewReversePerDay: 0, evolutionCardsEnabled: false },
    timezone: settings.timezone,
    push_notification_hour: settings.hour,
  });
  await db.insert("push_subscriptions", {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    p256dh: "p",
    auth_secret: "a",
  });
  if (due > 0) {
    await db.insert(
      "card_reviews",
      Array.from({ length: due }, (_, i) => ({ card_type: "name", subject_key: String(i + 1), locale: "en", due_date: dueDate })),
    );
  }
  return id;
}

const sentTo = () => send.mock.calls.map(([target]) => target.endpoint.split("/").pop());
const bodyFor = (name: string) => {
  const call = send.mock.calls.find(([target]) => target.endpoint.endsWith(`/${name}`));
  return call ? (JSON.parse(call[1] as string) as { body: string }).body : undefined;
};

describe("send-daily on D1: time zones", () => {
  it("each user is sent at their own local hour, whatever their zone", async () => {
    await player("london", { timezone: "Europe/London", hour: 9 }, 2, "2026-01-15");
    await player("newyork", { timezone: "America/New_York", hour: 7 }, 2, "2026-01-15");
    await player("tokyo", { timezone: "Asia/Tokyo", hour: 21 }, 2, "2026-01-15");
    await player("nopref", { timezone: "Asia/Kolkata", hour: null }, 2, "2026-01-15");

    const runs: Record<string, string[]> = {};
    for (const hour of ["08", "09", "12"]) {
      send.mockClear();
      at(`2026-01-15T${hour}:00:00Z`);
      expect((await POST(request())).status).toBe(200);
      runs[hour] = sentTo().sort() as string[];
    }
    // Winter: London is UTC+0, New York UTC-5, Tokyo UTC+9; no preference is 08:00 UTC.
    expect(runs).toEqual({ "08": ["nopref"], "09": ["london"], "12": ["newyork", "tokyo"] });
  });

  it("follows the clocks across a DST change (London, 29 March 2026)", async () => {
    await player("london", { timezone: "Europe/London", hour: 9 }, 1, "2026-03-01");
    const sentAt = async (iso: string) => {
      send.mockClear();
      at(iso);
      await POST(request());
      return sentTo().length;
    };
    // Saturday, GMT (UTC+0): 09:00 local is 09:00 UTC.
    expect(await sentAt("2026-03-28T09:00:00Z")).toBe(1);
    expect(await sentAt("2026-03-28T08:00:00Z")).toBe(0);
    // Sunday, BST (UTC+1) from 01:00 UTC: 09:00 local is 08:00 UTC.
    expect(await sentAt("2026-03-29T08:00:00Z")).toBe(1);
    expect(await sentAt("2026-03-29T09:00:00Z")).toBe(0);
  });

  it("follows the clocks across a DST change (New York, 8 March 2026)", async () => {
    await player("newyork", { timezone: "America/New_York", hour: 7 }, 1, "2026-03-01");
    const sentAt = async (iso: string) => {
      send.mockClear();
      at(iso);
      await POST(request());
      return sentTo().length;
    };
    expect(await sentAt("2026-03-07T12:00:00Z")).toBe(1); // EST, UTC-5
    expect(await sentAt("2026-03-08T11:00:00Z")).toBe(1); // EDT, UTC-4
    expect(await sentAt("2026-03-08T12:00:00Z")).toBe(0);
  });

  it("counts cards due by the user's local date, not the UTC date", async () => {
    // 20:00 UTC on 20 May is 08:00 on 21 May in Auckland (NZST, UTC+12).
    const auckland = await player("auckland", { timezone: "Pacific/Auckland", hour: 8 }, 0, "2026-05-21");
    await forUser(d1, auckland).insert("card_reviews", [
      { card_type: "name", subject_key: "1", locale: "en", due_date: "2026-05-21" },
      { card_type: "name", subject_key: "2", locale: "en", due_date: "2026-05-21" },
      { card_type: "name", subject_key: "3", locale: "en", due_date: "2026-05-22" },
    ]);
    at("2026-05-20T20:00:00Z");
    await POST(request());
    expect(bodyFor("auckland")).toMatch(/\b2 cards\b/);
  });
});

describe("send-daily on D1: outbound gate and clean-up", () => {
  it("outside production computes the targets but sends nothing and needs no VAPID key", async () => {
    await player("aaa", { timezone: "UTC", hour: 8 }, 3, "2026-01-15");
    await player("bbb", { timezone: "UTC", hour: 8 }, 1, "2026-01-15");
    await player("ccc", { timezone: "UTC", hour: 9 }, 1, "2026-01-15");
    env.DEPLOY_ENV = "cloudflare-preview";
    delete env.VAPID_PRIVATE_KEY;
    delete env.VAPID_SUBJECT;
    at("2026-01-15T08:00:00Z");
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 0, deleted: 0, wouldSend: 2 });
    expect(send).not.toHaveBeenCalled();
    expect(setVapid).not.toHaveBeenCalled();
  });

  it("in production a missing VAPID key is a 503", async () => {
    delete env.VAPID_PRIVATE_KEY;
    expect((await POST(request())).status).toBe(503);
  });

  it("deletes the subscriptions a push service reports gone, and only those", async () => {
    await player("gone", { timezone: "UTC", hour: 8 }, 1, "2026-01-15");
    await player("alive", { timezone: "UTC", hour: 8 }, 1, "2026-01-15");
    send.mockImplementation(async (target) => {
      if (target.endpoint.endsWith("/gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201, body: "", headers: {} };
    });
    at("2026-01-15T08:00:00Z");
    const res = await POST(request());
    expect(await res.json()).toEqual({ ok: true, sent: 1, deleted: 1 });
    expect((await getPushTargets(d1)).map((t) => t.endpoint.split("/").pop())).toEqual(["alive"]);
  });

  it("two users: each push counts only that user's own due cards", async () => {
    await player("few", { timezone: "UTC", hour: 8 }, 1, "2026-01-15");
    await player("many", { timezone: "UTC", hour: 8 }, 5, "2026-01-15");
    at("2026-01-15T08:00:00Z");
    await POST(request());
    expect(bodyFor("few")).toMatch(/\b1 card\b/);
    expect(bodyFor("many")).toMatch(/\b5 cards\b/);
  });
});
