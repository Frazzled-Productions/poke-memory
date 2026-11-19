/**
 * POST /api/db (task 3.1): the request checks around the gateway. The gateway
 * itself is covered in lib/db/gateway.test.ts, crossUser.test.ts and
 * clientGateway.test.ts; here each operation is also run once through the
 * route over the D1 test database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { seedBugReportWithDiscordPost } from "@/lib/db/testing/gatewayClient";
import { countDiscordPosts } from "@/lib/db/testing/rows";

const { requireAuth, getDb, waitUntil, workerEnv } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDb: vi.fn(),
  waitUntil: vi.fn(),
  workerEnv: {} as Record<string, unknown>,
}));
vi.mock("@/lib/auth/requireAuth", () => ({ requireAuth }));
vi.mock("@/lib/db/env", () => ({ getDb }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({ env: workerEnv, ctx: { waitUntil } }),
}));

import { POST } from "./route";
import { MAX_BODY_BYTES } from "@/lib/db/gateway";

const ORIGIN = "https://poke-memory.example";
let d1: SqliteD1;
let alice: string;
const TODAY = new Date().toISOString().slice(0, 10);

function post(body: unknown, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}/api/db`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const WEBHOOK = "https://discord.com/api/webhooks/123/abc";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  for (const key of Object.keys(workerEnv)) delete workerEnv[key];
  Object.assign(workerEnv, { DEPLOY_ENV: "cloudflare-production", DISCORD_NOTIFY_WEBHOOK_URL: WEBHOOK });
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  getDb.mockResolvedValue(d1);
  requireAuth.mockResolvedValue({ user: { id: alice } });
});
afterEach(() => {
  d1.close();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("request checks", () => {
  it("refuses a request from another origin, or with no Origin header, before the session is read (403)", async () => {
    for (const headers of [{ origin: "https://evil.example" }, {}, { origin: "null" }] as Record<string, string>[]) {
      const res = await POST(post({ kind: "select", table: "card_reviews" }, headers));
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("42501");
    }
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("answers 401 without a session and touches no data", async () => {
    requireAuth.mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await POST(post({ kind: "select", table: "card_reviews" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      data: null,
      error: { code: "PGRST301", message: "not signed in", details: null, hint: null },
    });
    expect(getDb).not.toHaveBeenCalled();
  });

  it("calls requireAuth with the request", async () => {
    const req = post({ kind: "select", table: "card_reviews" });
    await POST(req);
    expect(requireAuth).toHaveBeenCalledWith(req);
  });

  it("refuses a body that is not JSON (400) or too large (413)", async () => {
    expect((await POST(post("{not json"))).status).toBe(400);
    const big = JSON.stringify({ kind: "insert", table: "push_subscriptions", rows: { endpoint: "x".repeat(MAX_BODY_BYTES) } });
    expect((await POST(post(big))).status).toBe(413);
  });

  it("never lets an answer be cached", async () => {
    const res = await POST(post({ kind: "select", table: "card_reviews" }));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("each operation through the route", () => {
  const ok = async (q: unknown) => {
    const res = await POST(post(q));
    expect(res.status).toBe(200);
    return res.json();
  };

  it("upsert, select (with count), update, insert, delete and the RPCs", async () => {
    await ok({ kind: "rpc", name: "merge_user_settings", args: { p_user_id: alice, p_patch: { a: 1 } } });
    await ok({ kind: "update", table: "user_settings", values: { timezone: "UTC" }, filters: [{ column: "user_id", op: "eq", value: alice }] });
    await ok({ kind: "upsert", table: "streak_days", rows: [{ user_id: alice, review_date: TODAY }], onConflict: "user_id,review_date", ignoreDuplicates: true });
    await ok({ kind: "insert", table: "push_subscriptions", rows: { user_id: alice, endpoint: "https://fcm.googleapis.com/x", p256dh: "k", auth_secret: "s" } });
    expect(await ok({ kind: "select", table: "streak_days", columns: ["review_date"], count: "exact" })).toEqual({
      data: [{ review_date: TODAY }],
      error: null,
      count: 1,
    });
    expect(await ok({ kind: "select", table: "user_settings", columns: ["settings", "timezone"], single: "maybe" })).toMatchObject({
      data: { settings: { a: 1 }, timezone: "UTC" },
    });
    await ok({ kind: "delete", table: "push_subscriptions", filters: [{ column: "user_id", op: "eq", value: alice }] });
    await ok({ kind: "rpc", name: "reset_all_progress" });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("400 on unknown names, 403 on another user's id", async () => {
    expect((await POST(post({ kind: "select", table: "user" }))).status).toBe(400);
    expect((await POST(post({ kind: "select", table: "card_reviews", columns: ["password"] }))).status).toBe(400);
    expect((await POST(post({ kind: "rpc", name: "get_push_targets" }))).status).toBe(400);
    const other = createTestUser(d1);
    const res = await POST(post({ kind: "select", table: "card_reviews", filters: [{ column: "user_id", op: "eq", value: other }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("42501");
  });

  it("delete_account deletes the account's Discord posts through waitUntil, then their stored ids", async () => {
    seedBugReportWithDiscordPost(d1, alice, "f1", "m1");
    const res = await POST(post({ kind: "rpc", name: "delete_account" }));
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${WEBHOOK}/messages/m1`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(countDiscordPosts(d1)).toBe(0);
  });

  it("delete_account sends nothing to Discord when outbound is off, and keeps the stored ids", async () => {
    workerEnv.DEPLOY_ENV = "cloudflare-preview";
    vi.spyOn(console, "info").mockImplementation(() => {});
    seedBugReportWithDiscordPost(d1, alice, "f1", "m1");
    expect((await POST(post({ kind: "rpc", name: "delete_account" }))).status).toBe(200);
    await waitUntil.mock.calls[0][0];
    expect(fetchMock).not.toHaveBeenCalled();
    expect(countDiscordPosts(d1)).toBe(1);
  });

  it("delete_account keeps the stored id when Discord refuses the delete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    seedBugReportWithDiscordPost(d1, alice, "f1", "m1");
    expect((await POST(post({ kind: "rpc", name: "delete_account" }))).status).toBe(200);
    await waitUntil.mock.calls[0][0];
    expect(countDiscordPosts(d1)).toBe(1);
  });

});
