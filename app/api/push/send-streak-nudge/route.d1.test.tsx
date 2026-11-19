/**
 * POST /api/push/send-streak-nudge end to end on the D1 test database: the
 * real lib/db/system queries, time zones and a DST boundary for the 20:00
 * local gate and the local "reviewed today", a history longer than the old
 * 1000-row page, the outbound gate (design D2) and two users kept apart.
 * `web-push` is mocked: nothing is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

import webpush from "web-push";
import { POST } from "./route";
import { forUser } from "@/lib/db/scope";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";

const send = vi.mocked(webpush.sendNotification);

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
  new Request("http://localhost/api/push/send-streak-nudge", {
    method: "POST",
    headers: { Authorization: "Bearer secret-value" },
  });

/** `count` consecutive dates ending on `end` (inclusive). */
function datesEnding(end: string, count: number): string[] {
  const t = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(t - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** An opted-in, subscribed user with a streak of `days` ending on `lastDay` (local). */
async function player(name: string, timezone: string, days: number, lastDay: string) {
  const id = createTestUser(d1, { username: name });
  const db = forUser(d1, id);
  await db.insert("user_settings", { settings: { streakNudgeEnabled: true }, timezone, push_notification_hour: null });
  await db.insert("push_subscriptions", { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, p256dh: "p", auth_secret: "a" });
  if (days > 0) await db.insert("streak_days", datesEnding(lastDay, days).map((review_date) => ({ review_date })));
  return id;
}

const sentTo = () => send.mock.calls.map(([target]) => target.endpoint.split("/").pop()).sort();

describe("send-streak-nudge on D1", () => {
  it("nudges each at-risk user at 20:00 in their own zone", async () => {
    await player("london", "Europe/London", 3, "2026-01-14");
    await player("tokyo", "Asia/Tokyo", 3, "2026-01-14");
    at("2026-01-15T20:00:00Z");
    await POST(request());
    expect(sentTo()).toEqual(["london"]);
    send.mockClear();
    at("2026-01-15T11:00:00Z"); // 20:00 in Tokyo (UTC+9)
    await POST(request());
    expect(sentTo()).toEqual(["tokyo"]);
  });

  it("follows the clocks across a DST change (London, 29 March 2026)", async () => {
    await player("london", "Europe/London", 3, "2026-03-28");
    at("2026-03-29T20:00:00Z"); // 21:00 BST
    await POST(request());
    expect(sentTo()).toEqual([]);
    at("2026-03-29T19:00:00Z"); // 20:00 BST
    await POST(request());
    expect(sentTo()).toEqual(["london"]);
  });

  it("does not nudge a user who has reviewed today in their local day", async () => {
    // 11:00 UTC on 15 Jan is 20:00 on 15 Jan in Tokyo; the streak includes the 15th.
    await player("tokyo", "Asia/Tokyo", 3, "2026-01-15");
    at("2026-01-15T11:00:00Z");
    await POST(request());
    expect(send).not.toHaveBeenCalled();
  });

  it("reads the whole history: a 1200-day streak, and a second user after it who reviewed today", async () => {
    await player("aaa", "UTC", 1200, "2026-01-14");
    await player("zzz", "UTC", 3, "2026-01-15");
    at("2026-01-15T20:00:00Z");
    const res = await POST(request());
    expect(await res.json()).toEqual({ ok: true, sent: 1, deleted: 0 });
    expect(sentTo()).toEqual(["aaa"]);
    expect((JSON.parse(send.mock.calls[0][1] as string) as { body: string }).body).toContain("1,200");
  });

  it("outside production computes the targets but sends nothing and needs no VAPID key", async () => {
    await player("london", "Europe/London", 3, "2026-01-14");
    env.DEPLOY_ENV = "cloudflare-preview";
    delete env.VAPID_PRIVATE_KEY;
    at("2026-01-15T20:00:00Z");
    const res = await POST(request());
    expect(await res.json()).toEqual({ ok: true, sent: 0, deleted: 0, wouldSend: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(webpush.setVapidDetails).not.toHaveBeenCalled();
  });

  it("two users: one user's streak days never count for the other", async () => {
    await player("atrisk", "UTC", 3, "2026-01-14");
    await player("reviewed", "UTC", 3, "2026-01-15");
    at("2026-01-15T20:00:00Z");
    await POST(request());
    expect(sentTo()).toEqual(["atrisk"]);
  });
});
