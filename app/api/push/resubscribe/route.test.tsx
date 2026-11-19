/**
 * Tests for POST /api/push/resubscribe (#1858 F35) on D1: authentication
 * guard, payload validation, delete-then-insert through forUser, error
 * propagation and two-user isolation.
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
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1, type SpiedD1, type SpyHooks } from "@/lib/db/testing/spyD1";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/sub/1";

let d1: SqliteD1;
let db: SpiedD1;
let alice: string;
let bob: string;
let sessionUser: string | null;

function useDb(hooks: SpyHooks = {}) {
  db = spyD1(d1, hooks);
  getCloudflareContext.mockResolvedValue({ env: { DB: db } });
}

beforeEach(() => {
  vi.clearAllMocks();
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  bob = createTestUser(d1);
  sessionUser = alice;
  useDb();
  requireAuth.mockImplementation(async (_request: Request, options: { withOkField?: boolean } = {}) =>
    sessionUser
      ? { user: { id: sessionUser } }
      : NextResponse.json(options.withOkField ? { ok: false, error: "unauthorized" } : { error: "unauthorized" }, { status: 401 }),
  );
});
afterEach(() => d1.close());

function makeRequest(body: unknown): Request {
  return new Request("https://pokememory.com/api/push/resubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const subscriptionsOf = (userId: string) =>
  forUser(d1, userId).select("push_subscriptions", { order: [{ column: "endpoint" }] });

describe("POST /api/push/resubscribe", () => {
  it("returns 401 when the user is not authenticated", async () => {
    sessionUser = null;
    const res = await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "a", auth: "b" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
    expect(db.calls).toEqual([]);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const res = await POST(
      new Request("https://pokememory.com/api/push/resubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it.each([[{ endpoint: ENDPOINT }], [{ endpoint: "", p256dh: "a", auth: "b" }], [{ endpoint: ENDPOINT, p256dh: "", auth: "b" }]])(
    "returns 400 for %j",
    async (body) => {
      expect((await POST(makeRequest(body))).status).toBe(400);
    },
  );

  it("inserts the subscription for the session user and returns 200", async () => {
    const res = await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "p256dhkey", auth: "authkey" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await subscriptionsOf(alice)).toEqual([
      expect.objectContaining({ user_id: alice, endpoint: ENDPOINT, p256dh: "p256dhkey", auth_secret: "authkey" }),
    ]);
    // delete first, then insert
    expect(db.calls.map((c) => c.table)).toEqual(["push_subscriptions", "push_subscriptions"]);
    expect(db.calls[0].sql).toMatch(/^DELETE/);
    expect(db.calls[1].sql).toMatch(/^INSERT/);
  });

  it("replaces the keys of an existing subscription for the same endpoint", async () => {
    await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "old", auth: "old" }));
    await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "new", auth: "new" }));
    const rows = await subscriptionsOf(alice);
    expect(rows.map((r) => [r.p256dh, r.auth_secret])).toEqual([["new", "new"]]);
  });

  it("returns 500 delete_failed when the delete fails", async () => {
    useDb({
      before: (s) => {
        if (s.sql.startsWith("DELETE")) throw new Error("D1_ERROR: down");
      },
    });
    const res = await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "p", auth: "a" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "delete_failed" });
  });

  it("returns 500 insert_failed when the insert fails", async () => {
    useDb({
      before: (s) => {
        if (s.sql.startsWith("INSERT")) throw new Error("D1_ERROR: down");
      },
    });
    const res = await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "p", auth: "a" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "insert_failed" });
  });

  it("Unknown host: returns 400 invalid_payload and writes nothing", async () => {
    const res = await POST(makeRequest({ endpoint: "https://push.example/sub/1", p256dh: "p", auth: "a" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_payload" });
    expect(db.calls).toEqual([]);
  });

  describe("two users", () => {
    it("user B resubscribing the same endpoint never deletes or changes user A's row", async () => {
      await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "alice", auth: "alice" }));
      sessionUser = bob;
      const res = await POST(makeRequest({ endpoint: ENDPOINT, p256dh: "bob", auth: "bob" }));
      expect(res.status).toBe(200);
      expect((await subscriptionsOf(alice)).map((r) => r.p256dh)).toEqual(["alice"]);
      expect((await subscriptionsOf(bob)).map((r) => [r.user_id, r.p256dh])).toEqual([[bob, "bob"]]);
    });
  });
});
