/**
 * The cron routes of design D2 on the D1 test database: feedback retention
 * (034, with the Discord post deletion of 051), the grade_log reconcile dry
 * run (032), the rate-limit clean-up (041) and the backup (D10); then every
 * route in CRON_ROUTES called the way worker/index.ts calls them, through
 * runCronRoutes with the bearer secret. `fetch` and `web-push` are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } }));

import { POST as feedbackRetention } from "./feedback-retention/route";
import { POST as reconcileGradeLog } from "./reconcile-grade-log/route";
import { POST as rateLimitCleanup } from "./rate-limit-cleanup/route";
import { POST as backup } from "./backup/route";
import { POST as sendDaily } from "../push/send-daily/route";
import { POST as sendStreakNudge } from "../push/send-streak-nudge/route";
import { POST as discordDigest } from "../discord/digest/route";
import { CRON_ROUTES, HALF_HOURLY_CRON, HOURLY_CRON, cronRoutesFor } from "@/lib/cron/schedule";
import { runCronRoutes } from "@/lib/cron/run";
import type { R2BucketLike } from "@/lib/db/d1";
import { forUser } from "@/lib/db/scope";
import { checkRateLimit, discordPostStore, insertFeedback } from "@/lib/db/system";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";

const SECRET = "cron-secret";
const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

function fakeBucket() {
  const objects = new Map<string, string>();
  const bucket: R2BucketLike & { objects: Map<string, string> } = {
    objects,
    async put(key, value) {
      objects.set(key, String(value));
      return {};
    },
    async get(key) {
      const body = objects.get(key);
      return body === undefined ? null : { text: async () => body };
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
    async list({ prefix = "" } = {}) {
      return {
        objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, uploaded: new Date() })),
        truncated: false,
      };
    },
  };
  return bucket;
}

let d1: SqliteD1;
let env: Record<string, unknown>;
let bucket: ReturnType<typeof fakeBucket>;
let alice: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  for (const level of ["error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bucket = fakeBucket();
  env = {
    DB: d1,
    BACKUPS: bucket,
    DEPLOY_ENV: "cloudflare-production",
    CRON_SHARED_SECRET: SECRET,
    DISCORD_NOTIFY_WEBHOOK_URL: WEBHOOK,
    DISCORD_DIGEST_WEBHOOK_URL: "https://discord.com/api/webhooks/456/digest",
    VAPID_PRIVATE_KEY: "vapid-priv",
    VAPID_SUBJECT: "mailto:test@example.com",
  };
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "vapid-pub";
  getCloudflareContext.mockImplementation(async () => ({ env, ctx: { waitUntil: vi.fn() } }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  d1.close();
});

const post = (path: string, secret: string | null = SECRET) =>
  new Request(`https://poke-memory.internal${path}`, {
    method: "POST",
    headers: secret === null ? {} : { Authorization: `Bearer ${secret}` },
  });

const CRON_HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
  [CRON_ROUTES.sendDaily]: sendDaily,
  [CRON_ROUTES.sendStreakNudge]: sendStreakNudge,
  [CRON_ROUTES.discordDigest]: discordDigest,
  [CRON_ROUTES.feedbackRetention]: feedbackRetention,
  [CRON_ROUTES.reconcileGradeLog]: reconcileGradeLog,
  [CRON_ROUTES.rateLimitCleanup]: rateLimitCleanup,
  [CRON_ROUTES.backup]: backup,
};

describe("cron routes: the bearer gate", () => {
  it.each(Object.entries(CRON_HANDLERS))("%s refuses a missing or wrong bearer with an empty 401", async (path, handler) => {
    for (const secret of [null, "wrong", "cron-secreX"]) {
      const res = await handler(post(path, secret));
      expect(res.status, `${path} ${secret}`).toBe(401);
      expect(await res.text()).toBe("");
    }
  });

  it.each(Object.entries(CRON_HANDLERS))("%s answers 503 without CRON_SHARED_SECRET", async (path, handler) => {
    delete env.CRON_SHARED_SECRET;
    expect((await handler(post(path))).status).toBe(503);
  });
});

describe("POST /api/cron/feedback-retention", () => {
  async function feedbackAt(category: "bug" | "feature", createdAt: string) {
    const [row] = await forUser(d1, alice).insert(
      "feedback",
      { category, message: "m", created_at: createdAt },
      { returning: ["id"] },
    );
    return row.id as string;
  }

  it("deletes feedback older than 12 months and the Discord posts of deleted bug reports", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T03:00:00.000Z"));
    const oldBug = await feedbackAt("bug", "2025-11-18T00:00:00.000Z");
    const oldFeature = await feedbackAt("feature", "2025-01-01T00:00:00.000Z");
    const recentBug = await feedbackAt("bug", "2025-11-20T00:00:00.000Z");
    const store = discordPostStore(d1);
    await store.storeMessageId(oldBug, "msg-old");
    await store.storeMessageId(recentBug, "msg-recent");

    const res = await feedbackRetention(post(CRON_ROUTES.feedbackRetention));
    expect(await res.json()).toEqual({ ok: true, deleted: 2, postsDeleted: 1, postsFailed: 0 });
    expect((await forUser(d1, alice).select("feedback")).map((r) => r.id)).toEqual([recentBug]);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      [`${WEBHOOK}/messages/msg-old`, "DELETE"],
    ]);
    expect(await store.messageIdFor(oldBug)).toBeNull();
    expect(await store.messageIdFor(recentBug)).toBe("msg-recent");
    expect(oldFeature).toBeDefined();
  });

  it("keeps the stored id of a post Discord would not delete, and reports it", async () => {
    const id = await feedbackAt("bug", "2020-01-01T00:00:00.000Z");
    await discordPostStore(d1).storeMessageId(id, "msg-1");
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await feedbackRetention(post(CRON_ROUTES.feedbackRetention));
    expect(await res.json()).toEqual({ ok: true, deleted: 1, postsDeleted: 0, postsFailed: 1 });
    expect(await discordPostStore(d1).messageIdFor(id)).toBe("msg-1");
  });

  it("outside production deletes the feedback but makes no Discord call", async () => {
    env.DEPLOY_ENV = "cloudflare-preview";
    const id = await feedbackAt("bug", "2020-01-01T00:00:00.000Z");
    await discordPostStore(d1).storeMessageId(id, "msg-1");
    const res = await feedbackRetention(post(CRON_ROUTES.feedbackRetention));
    expect(await res.json()).toEqual({ ok: true, deleted: 1, postsDeleted: 0, postsFailed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/reconcile-grade-log", () => {
  it("runs in dry-run mode, as the pg_cron job did: counts orphans, inserts nothing", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await forUser(d1, alice).insert("grade_log", {
      occurred_at: 1,
      entry_date: today,
      card_type: "name",
      grade: 4,
      subject_key: "25",
      locale: "en",
    });
    const res = await reconcileGradeLog(post(CRON_ROUTES.reconcileGradeLog));
    expect(await res.json()).toEqual({ ok: true, dryRun: true, orphans: 1, inserted: 0 });
    expect(await forUser(d1, alice).select("card_reviews")).toEqual([]);
  });
});

describe("POST /api/cron/rate-limit-cleanup", () => {
  it("deletes buckets older than two hours", async () => {
    const now = Date.now();
    await checkRateLimit(d1, "a".repeat(64), "signin", new Date(now - 3 * 3_600_000));
    await checkRateLimit(d1, "a".repeat(64), "signin", new Date(now - 60_000));
    const res = await rateLimitCleanup(post(CRON_ROUTES.rateLimitCleanup));
    expect(await res.json()).toEqual({ ok: true, deleted: 1 });
  });
});

describe("POST /api/cron/backup", () => {
  it("writes today's backup to R2 and answers with counts only", async () => {
    await insertFeedback(d1, { user_id: alice, category: "bug", message: "private words", page: null, app_version: null });
    const res = await backup(post(CRON_ROUTES.backup));
    const body = (await res.json()) as { ok: boolean; key: string; counts: Record<string, number> };
    expect(body.ok).toBe(true);
    expect(body.key).toBe(`d1/${new Date().toISOString().slice(0, 10)}.sql`);
    expect(body.counts).toMatchObject({ user: 1, feedback: 1 });
    expect(JSON.stringify(body)).not.toContain("private words");
    expect(bucket.objects.get(body.key)).toContain("private words");
  });

  it("answers 503 without the BACKUPS binding", async () => {
    delete env.BACKUPS;
    expect((await backup(post(CRON_ROUTES.backup))).status).toBe(503);
  });
});

describe("every route through runCronRoutes (worker/index.ts)", () => {
  it("each CRON_ROUTES path is handled and answers 200 to the scheduled POST", async () => {
    const all = Object.values(CRON_ROUTES);
    // Every route the schedule can produce has a handler here.
    const scheduled = new Set([
      ...cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T09:00:00Z")),
      ...cronRoutesFor(HOURLY_CRON, new Date("2026-11-15T04:00:00Z")),
      ...cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T02:00:00Z")),
      ...cronRoutesFor(HOURLY_CRON, new Date("2026-11-16T03:00:00Z")),
      ...cronRoutesFor(HALF_HOURLY_CRON, new Date("2026-11-16T03:30:00Z")),
    ]);
    expect([...scheduled].sort()).toEqual([...all].sort());

    const waited: Promise<unknown>[] = [];
    const results = await runCronRoutes({
      routes: all,
      origin: "https://poke-memory.internal",
      secret: SECRET,
      fetchRoute: (request) => CRON_HANDLERS[new URL(request.url).pathname](request),
      waitUntil: (p) => waited.push(p),
      log: { info: () => {}, error: () => {} },
    });
    expect(waited).toHaveLength(all.length);
    expect(results.map((r) => [r.route, r.status])).toEqual(all.map((route) => [route, 200]));
  });
});
