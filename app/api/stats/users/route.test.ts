/**
 * GET /api/stats/users (design D13): the README user-count badge, served by the Worker as
 * Shields.io endpoint JSON, so no GitHub runner reads the database for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { GET } from "./route";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";

let d1: SqliteD1;
/** A D1 binding whose every statement fails. */
const brokenDb = {
  prepare() {
    throw new Error("D1 unavailable");
  },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  d1 = createSqliteD1();
  getCloudflareContext.mockImplementation(async () => ({ env: { DB: d1 }, ctx: { waitUntil: vi.fn() } }));
});
afterEach(() => {
  vi.restoreAllMocks();
  d1.close();
});

describe("GET /api/stats/users", () => {
  it("answers the account count as Shields.io endpoint JSON, cached for an hour", async () => {
    createTestUser(d1);
    createTestUser(d1);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: 1, label: "users", message: "2", color: "blue", cacheSeconds: 3600 });
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("answers 0 with no accounts", async () => {
    expect((await (await GET()).json()).message).toBe("0");
  });

  it("answers 503, uncached, when the count fails, and logs it", async () => {
    getCloudflareContext.mockImplementation(async () => ({ env: { DB: brokenDb }, ctx: { waitUntil: vi.fn() } }));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^\[stats\/users\] count failed/));
  });
});
