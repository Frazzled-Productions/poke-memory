/**
 * Tests for POST /api/feedback (#1621) on the D1 test database.
 *
 * Covers the acceptance criteria (valid and invalid categories, missing or
 * empty message, 2000-character truncation, guest and signed-in user_id from
 * the session only, optional fields, 500 on an insert failure), the per-IP
 * rate limit on rate_limit_buckets keyed on CF-Connecting-IP, and the
 * Discord bug notification the route now sends itself through
 * ctx.waitUntil (design D3), with its message id stored. `fetch` is mocked:
 * nothing reaches Discord.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const { getCloudflareContext, requireAuth } = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  requireAuth: vi.fn(),
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth }));

import { POST } from "./route";
import { forUser } from "@/lib/db/scope";
import { discordPostStore, feedbackForDigest } from "@/lib/db/system";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1, type SpyHooks } from "@/lib/db/testing/spyD1";

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

let d1: SqliteD1;
let env: Record<string, unknown>;
let alice: string;
let bob: string;
let sessionUser: string | null;
let waitUntil: ReturnType<typeof vi.fn>;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ id: "discord-msg-1" }));
  for (const level of ["error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  sessionUser = null;
  waitUntil = vi.fn();
  env = { DB: d1, DEPLOY_ENV: "cloudflare-production", DISCORD_NOTIFY_WEBHOOK_URL: WEBHOOK };
  getCloudflareContext.mockImplementation(async () => ({ env, ctx: { waitUntil } }));
  requireAuth.mockReset();
  requireAuth.mockImplementation(async () =>
    sessionUser ? { user: { id: sessionUser } } : NextResponse.json({ error: "unauthorized" }, { status: 401 }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  d1.close();
});

function useDb(hooks: SpyHooks) {
  env.DB = spyD1(d1, hooks);
}

let ipCounter = 0;
/** A request with the given JSON body, from a fresh IP unless one is given. */
function makeRequest(body: unknown, ip = `198.51.100.${++ipCounter}`, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Every feedback row, as the retention and digest jobs see them. */
async function allFeedback() {
  const rows = await feedbackForDigest(d1, new Date(0));
  const owned = [...(await forUser(d1, alice).select("feedback")), ...(await forUser(d1, bob).select("feedback"))];
  return rows.map((r) => ({
    ...r,
    row: owned.find((o) => o.id === r.id) ?? null,
  }));
}

describe("POST /api/feedback - valid categories", () => {
  for (const cat of ["bug", "feature", "other"] as const) {
    it(`accepts category '${cat}' and returns 200 { ok: true }`, async () => {
      const res = await POST(makeRequest({ category: cat, message: "Hello" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect((await allFeedback()).map((r) => r.category)).toEqual([cat]);
    });
  }
});

describe("POST /api/feedback - input validation", () => {
  it.each([
    ["an invalid category", { category: "spam", message: "x" }, "invalid_category"],
    ["a missing category", { message: "x" }, "invalid_category"],
    ["a missing message", { category: "bug" }, "missing_message"],
    ["an empty message", { category: "bug", message: "   " }, "missing_message"],
    ["a non-string message", { category: "bug", message: 42 }, "missing_message"],
  ])("returns 400 for %s and inserts nothing", async (_label, body, error) => {
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error });
    expect(await allFeedback()).toEqual([]);
  });

  it("returns 400 for a non-JSON body", async () => {
    expect((await POST(makeRequest("not json"))).status).toBe(400);
  });
});

describe("POST /api/feedback - stored row", () => {
  it("truncates a message longer than 2000 chars, and keeps exactly 2000", async () => {
    sessionUser = alice;
    await POST(makeRequest({ category: "feature", message: "a".repeat(2500) }));
    await POST(makeRequest({ category: "feature", message: "b".repeat(2000) }));
    const messages = (await forUser(d1, alice).select("feedback")).map((r) => r.message as string);
    expect(messages.map((m) => m.length).sort()).toEqual([2000, 2000]);
  });

  it("stores user_id null for a guest", async () => {
    await POST(makeRequest({ category: "other", message: "hi" }));
    const [row] = await allFeedback();
    expect(row).toMatchObject({ authenticated: false, row: null });
  });

  it("stores the session user's id for a signed-in user", async () => {
    sessionUser = alice;
    await POST(makeRequest({ category: "other", message: "hi" }));
    expect((await forUser(d1, alice).select("feedback")).map((r) => r.user_id)).toEqual([alice]);
  });

  it("ignores a user_id in the body (cannot spoof another user)", async () => {
    sessionUser = bob;
    await POST(makeRequest({ category: "other", message: "hi", user_id: alice }));
    expect(await forUser(d1, alice).select("feedback")).toEqual([]);
    expect((await forUser(d1, bob).select("feedback")).map((r) => r.user_id)).toEqual([bob]);
  });

  it("falls back to a guest row when the session check throws", async () => {
    requireAuth.mockRejectedValue(new Error("session store down"));
    const res = await POST(makeRequest({ category: "other", message: "hi" }));
    expect(res.status).toBe(200);
    expect((await allFeedback())[0].authenticated).toBe(false);
  });

  it("stores page and appVersion, capped at 300 characters, or null when absent", async () => {
    sessionUser = alice;
    await POST(makeRequest({ category: "feature", message: "a", page: "/practice", appVersion: "v".repeat(400) }));
    await POST(makeRequest({ category: "feature", message: "b" }));
    const rows = await forUser(d1, alice).select("feedback", { order: [{ column: "message" }] });
    expect(rows.map((r) => [r.page, (r.app_version as string | null)?.length ?? null])).toEqual([
      ["/practice", 300],
      [null, null],
    ]);
  });
});

describe("POST /api/feedback - error handling", () => {
  it("returns 500 { ok: false } when the insert fails", async () => {
    useDb({
      before: (s) => {
        if (s.table === "feedback") throw new Error("D1_ERROR: down");
      },
    });
    const res = await POST(makeRequest({ category: "bug", message: "x" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("POST /api/feedback - rate limit (#1883)", () => {
  it("refuses the 6th submission from one IP within 10 minutes with 429", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(makeRequest({ category: "other", message: `m${i}` }, "203.0.113.7"))).status).toBe(200);
    }
    const res = await POST(makeRequest({ category: "other", message: "m6" }, "203.0.113.7"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(await allFeedback()).toHaveLength(5);
    // Another IP is unaffected.
    expect((await POST(makeRequest({ category: "other", message: "x" }, "203.0.113.8"))).status).toBe(200);
  });

  it("keys on CF-Connecting-IP, never on a client-set X-Forwarded-For", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(makeRequest({ category: "other", message: `m${i}` }, "203.0.113.9", { "X-Forwarded-For": `10.0.0.${i}` }));
    }
    const res = await POST(
      makeRequest({ category: "other", message: "m6" }, "203.0.113.9", { "X-Forwarded-For": "10.0.0.99" }),
    );
    expect(res.status).toBe(429);
  });

  it("proceeds (fail-open) when the rate-limit check fails", async () => {
    useDb({
      before: (s) => {
        if (s.table === "rate_limit_buckets") throw new Error("D1_ERROR: down");
      },
    });
    expect((await POST(makeRequest({ category: "other", message: "x" }))).status).toBe(200);
  });
});

describe("POST /api/feedback - Discord bug notification (design D3)", () => {
  it("sends a bug report to Discord through ctx.waitUntil and stores the message id", async () => {
    sessionUser = alice;
    const res = await POST(makeRequest({ category: "bug", message: "it crashed", page: "/practice", appVersion: "1.2.3" }));
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];

    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}?wait=true`);
    const payload = String(fetchMock.mock.calls[0][1]!.body);
    expect(payload).toContain("it crashed");
    expect(payload).toContain('"Yes"');
    expect(payload).not.toContain(alice);
    const [row] = await forUser(d1, alice).select("feedback");
    expect(await discordPostStore(d1).messageIdFor(row.id as string)).toBe("discord-msg-1");
  });

  it("does not notify for a feature request or other feedback", async () => {
    await POST(makeRequest({ category: "feature", message: "x" }));
    await POST(makeRequest({ category: "other", message: "x" }));
    expect(waitUntil).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still answers 200 when Discord fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const res = await POST(makeRequest({ category: "bug", message: "x" }));
    expect(res.status).toBe(200);
    await waitUntil.mock.calls[0][0];
  });

  it("outside production stores the row but sends nothing", async () => {
    env.DEPLOY_ENV = "cloudflare-preview";
    delete env.DISCORD_NOTIFY_WEBHOOK_URL;
    const res = await POST(makeRequest({ category: "bug", message: "x" }));
    expect(res.status).toBe(200);
    await waitUntil.mock.calls[0][0];
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await allFeedback()).toHaveLength(1);
  });
});
