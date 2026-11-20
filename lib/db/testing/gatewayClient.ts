/**
 * Test helper: the real browser data client (lib/db/client.ts) wired through a
 * fetch shim to the real gateway (lib/db/gateway.ts) over a test D1, with a
 * fixed session user. Requests and responses go through JSON, as on the wire.
 *
 *   const d1 = createSqliteD1();
 *   const alice = createTestUser(d1);
 *   const db = createGatewayTestClient(d1, alice);
 *   await pullSession(db, alice);
 *
 * `fail` makes the shim answer like a dead network for matching requests, to
 * test the sync layer's failure paths.
 */
import { createDataClient, type DataClient } from "../client";
import type { D1DatabaseLike } from "../d1";
import { handleGatewayRequest } from "../gateway";
import type { SqliteD1 } from "./sqliteD1";

export interface GatewayTestOptions {
  /** Return true to fail this request with a network error. */
  fail?: (request: Record<string, unknown>) => boolean;
  /** Every request body the client sent, in order. */
  sent?: Record<string, unknown>[];
}

export function createGatewayTestClient(
  d1: D1DatabaseLike,
  sessionUserId: string,
  options: GatewayTestOptions = {},
): DataClient {
  const shim: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    options.sent?.push(body);
    if (options.fail?.(body)) throw new TypeError("Failed to fetch");
    const result = await handleGatewayRequest(d1, sessionUserId, body);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return createDataClient({ fetch: shim });
}

/**
 * Seeds a bug report for `userId`, for tests outside lib/db that cannot hold
 * SQL (scripts/check-scoped-queries.mjs).
 */
export function seedBugReport(d1: SqliteD1, userId: string, feedbackId: string): void {
  d1.sqlite
    .prepare(`INSERT INTO feedback (id, user_id, category, message) VALUES (?, ?, 'bug', 'test')`)
    .run(feedbackId, userId);
}
