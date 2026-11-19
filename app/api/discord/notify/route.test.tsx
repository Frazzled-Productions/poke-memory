/**
 * Tests for POST /api/discord/notify (#1653, #1848, ops #405) on D1: the
 * bearer gate, body checks, and the wiring to lib/discord/notify.ts against
 * the D1 test database (message preview read by id, message id stored in
 * feedback_discord_posts and deleted with the post). The embed and Discord
 * error handling are covered in lib/discord/notify.test.ts. `fetch` is
 * mocked: nothing reaches Discord.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { POST } from "./route";
import { discordPostStore, insertFeedback } from "@/lib/db/system";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1 } from "@/lib/db/testing/spyD1";

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";

let d1: SqliteD1;
let env: Record<string, unknown>;
let feedbackId: string;
let createdAt: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ id: "msg-1" }));
  for (const level of ["error", "warn", "info"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  d1 = createSqliteD1();
  const user = createTestUser(d1);
  ({ id: feedbackId, created_at: createdAt } = await insertFeedback(d1, {
    user_id: user,
    category: "bug",
    message: "app crashes on the practice screen",
    page: "/practice",
    app_version: "1.2.3",
  }));
  env = { DB: d1, DEPLOY_ENV: "cloudflare-production", CRON_SHARED_SECRET: "test-secret", DISCORD_NOTIFY_WEBHOOK_URL: WEBHOOK };
  getCloudflareContext.mockImplementation(async () => ({ env }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  d1.close();
});

function notice() {
  return { id: feedbackId, category: "bug", page: "/practice", app_version: "1.2.3", created_at: createdAt, authenticated: true };
}

function makeRequest(body: unknown, secret = "test-secret"): Request {
  return new Request("http://localhost/api/discord/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const storedId = () => discordPostStore(d1).messageIdFor(feedbackId);

describe("POST /api/discord/notify - gates", () => {
  it("returns 503 when CRON_SHARED_SECRET is missing", async () => {
    delete env.CRON_SHARED_SECRET;
    expect((await POST(makeRequest(notice()))).status).toBe(503);
  });

  it("returns 503 in production without DISCORD_NOTIFY_WEBHOOK_URL", async () => {
    delete env.DISCORD_NOTIFY_WEBHOOK_URL;
    const res = await POST(makeRequest(notice()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "misconfigured" });
  });

  it.each([
    ["missing", null],
    ["wrong", "wrong-secret"],
    ["a different length", "x"],
  ])("returns an empty 401 for a %s bearer token", async (_label, secret) => {
    const req = secret === null
      ? new Request("http://localhost/api/discord/notify", { method: "POST", body: JSON.stringify(notice()) })
      : makeRequest(notice(), secret);
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("returns 400 for an invalid JSON body", async () => {
    expect((await POST(makeRequest("not json"))).status).toBe(400);
  });

  it.each(["message", "user_id"])("returns 400 if the body contains the forbidden field %s", async (field) => {
    const res = await POST(makeRequest({ ...notice(), [field]: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden_fields" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/discord/notify - posting", () => {
  it("posts with the message preview read from D1 and stores the message id", async () => {
    const res = await POST(makeRequest(notice()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}?wait=true`);
    const payload = String(fetchMock.mock.calls[0][1]!.body);
    expect(payload).toContain("app crashes on the practice screen");
    expect(payload).not.toContain("user_id");
    expect(await storedId()).toBe("msg-1");
  });

  it("answers 502 when Discord fails, storing nothing", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const res = await POST(makeRequest(notice()));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "webhook_error", status: 500 });
    expect(await storedId()).toBeNull();
  });

  it("answers 502 when the fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const res = await POST(makeRequest(notice()));
    expect(await res.json()).toEqual({ ok: false, error: "webhook_fetch_failed" });
  });

  it("still answers 200 when the database is down: no preview, no stored id", async () => {
    env.DB = spyD1(d1, {
      before: () => {
        throw new Error("D1_ERROR: down");
      },
    });
    const res = await POST(makeRequest(notice()));
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][1]!.body)).not.toContain("Message preview");
  });

  it("outside production sends nothing and stores nothing", async () => {
    env.DEPLOY_ENV = "cloudflare-preview";
    delete env.DISCORD_NOTIFY_WEBHOOK_URL;
    const res = await POST(makeRequest(notice()));
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await storedId()).toBeNull();
  });
});

describe("POST /api/discord/notify - deletion (ops #405)", () => {
  beforeEach(async () => {
    await discordPostStore(d1).storeMessageId(feedbackId, "msg-7");
  });

  it("CRITICAL: deletes the stored Discord message, then the stored id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await POST(makeRequest({ event: "deleted", id: feedbackId }));
    expect(await res.json()).toEqual({ ok: true, deleted: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}/messages/msg-7`);
    expect(fetchMock.mock.calls[0][1]!.method).toBe("DELETE");
    expect(await storedId()).toBeNull();
  });

  it("answers 200 deleted:false and calls Discord not at all when no id was stored", async () => {
    const res = await POST(makeRequest({ event: "deleted", id: "00000000-0000-4000-8000-000000000000" }));
    expect(await res.json()).toEqual({ ok: true, deleted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 and keeps the stored id when Discord fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    const res = await POST(makeRequest({ event: "deleted", id: feedbackId }));
    expect(res.status).toBe(502);
    expect(await storedId()).toBe("msg-7");
  });

  it("answers 502 lookup_failed when the stored id cannot be read", async () => {
    env.DB = spyD1(d1, {
      before: () => {
        throw new Error("D1_ERROR: down");
      },
    });
    const res = await POST(makeRequest({ event: "deleted", id: feedbackId }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "lookup_failed" });
  });

  it("answers 400 to a deletion event without an id", async () => {
    const res = await POST(makeRequest({ event: "deleted" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "missing_id" });
  });

  it("still refuses a deletion body holding message or user_id", async () => {
    expect((await POST(makeRequest({ event: "deleted", id: feedbackId, user_id: "x" }))).status).toBe(400);
  });
});
