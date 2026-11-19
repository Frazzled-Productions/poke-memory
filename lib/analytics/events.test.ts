/**
 * Tests for the daily event counts in lib/analytics/events.ts and the table in
 * db/d1/migrations/0003_events.sql. The real-SQL tests apply the migration to
 * an in-memory node:sqlite database (the engine D1 runs) behind a minimal
 * D1-shaped adapter, so the upsert and the table's constraints are exercised.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EVENT_NAMES,
  PROGRESS_BUCKETS,
  USER_TYPES,
  handleEvent,
  sendEvent,
  type EventEnv,
} from "./events";

const APP = "https://pokememory.com";
const NOW = new Date("2026-11-19T21:30:00Z");
const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../db/d1/migrations/0003_events.sql"),
  "utf8",
);

const GOOD = JSON.stringify({
  name: "app_open",
  props: { userType: "new", progressBucket: "0" },
});

type Call = { sql: string; args: unknown[] };

/** A D1-shaped wrapper over node:sqlite with the migration applied. */
function sqliteDb(options: { fail?: boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(MIGRATION);
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              calls.push({ sql, args });
              if (options.fail) throw new Error("D1_ERROR: daily write limit reached");
              sqlite.prepare(sql).run(...(args as string[]));
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db, calls, sqlite };
}

function fakeLimiter(allow = true) {
  const keys: string[] = [];
  return {
    limiter: {
      async limit({ key }: { key: string }) {
        keys.push(key);
        return { success: allow };
      },
    },
    keys,
  };
}

function makeEnv(options: { allow?: boolean; failDb?: boolean } = {}) {
  const d1 = sqliteDb({ fail: options.failDb });
  const rl = fakeLimiter(options.allow ?? true);
  const env = { DB: d1.db, EVENT_LIMITER: rl.limiter } as unknown as EventEnv;
  return { env, d1, rl };
}

function post(body: string, origin: string | null = APP, method = "POST") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin !== null) headers.set("Origin", origin);
  return new Request(`${APP}/api/event`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

function rows(sqlite: DatabaseSync) {
  return sqlite.prepare("SELECT * FROM events ORDER BY user_type, progress_bucket").all();
}

describe("0003_events.sql", () => {
  it("has exactly the day, name, two buckets and count: no personal column", () => {
    const { sqlite } = sqliteDb();
    const columns = sqlite
      .prepare("SELECT name FROM pragma_table_info('events') ORDER BY cid")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual(["day", "name", "user_type", "progress_bucket", "count"]);
  });

  it("is STRICT with the primary key on the first four columns", () => {
    const { sqlite } = sqliteDb();
    const table = sqlite
      .prepare("SELECT strict FROM pragma_table_list WHERE name = 'events'")
      .get() as { strict: number };
    expect(table.strict).toBe(1);
    const pk = sqlite
      .prepare("SELECT name FROM pragma_table_info('events') WHERE pk > 0 ORDER BY pk")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(pk).toEqual(["day", "name", "user_type", "progress_bucket"]);
  });

  it("refuses a value outside the allowed buckets even if written directly", () => {
    const { sqlite } = sqliteDb();
    const insert = sqlite.prepare(
      "INSERT INTO events (day, name, user_type, progress_bucket, count) VALUES (?, ?, ?, ?, 1)",
    );
    expect(() => insert.run("2026-11-19", "page_view", "new", "0")).toThrow(/CHECK/);
    expect(() => insert.run("2026-11-19", "app_open", "someone@example.com", "0")).toThrow(/CHECK/);
    expect(() => insert.run("2026-11-19", "app_open", "new", "42")).toThrow(/CHECK/);
    expect(() => insert.run("2026-11-19T21:30", "app_open", "new", "0")).toThrow(/CHECK/);
  });
});

describe("the allowed values", () => {
  it("are exactly the FunnelTracker event, user types and progress buckets", () => {
    expect([...EVENT_NAMES]).toEqual(["app_open"]);
    expect([...USER_TYPES]).toEqual(["new", "returning_guest", "signed_in"]);
    expect([...PROGRESS_BUCKETS]).toEqual(["0", "1-10", "11-50", "50+"]);
  });
});

describe("handleEvent", () => {
  it("counts an app_open from the app itself: 204, no-store, no cookie, one upsert", async () => {
    const { env, d1, rl } = makeEnv();
    const res = await handleEvent(post(GOOD), env, NOW);
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(d1.calls).toHaveLength(1);
    expect(d1.calls[0].args).toEqual(["2026-11-19", "app_open", "new", "0"]);
    expect(rows(d1.sqlite)).toEqual([
      { day: "2026-11-19", name: "app_open", user_type: "new", progress_bucket: "0", count: 1 },
    ]);
    expect(rl.keys).toEqual(["app_open"]);
  });

  it("binds only the UTC day, the name and the two buckets", async () => {
    const { env, d1 } = makeEnv();
    // 00:30 UTC on the 20th is the 20th whatever the local zone.
    const body = JSON.stringify({
      name: "app_open",
      props: { userType: "signed_in", progressBucket: "50+" },
    });
    await handleEvent(post(body), env, new Date("2026-11-20T00:30:00Z"));
    expect(d1.calls[0].args).toEqual(["2026-11-20", "app_open", "signed_in", "50+"]);
  });

  it("adds to the same row on the same day and keeps other buckets apart", async () => {
    const { env, d1 } = makeEnv();
    const other = JSON.stringify({
      name: "app_open",
      props: { userType: "returning_guest", progressBucket: "11-50" },
    });
    await handleEvent(post(GOOD), env, NOW);
    await handleEvent(post(GOOD), env, new Date("2026-11-19T08:00:00Z"));
    await handleEvent(post(other), env, NOW);
    expect(rows(d1.sqlite)).toEqual([
      { day: "2026-11-19", name: "app_open", user_type: "new", progress_bucket: "0", count: 2 },
      {
        day: "2026-11-19",
        name: "app_open",
        user_type: "returning_guest",
        progress_bucket: "11-50",
        count: 1,
      },
    ]);
  });

  it("accepts every allowed combination", async () => {
    for (const userType of USER_TYPES) {
      for (const progressBucket of PROGRESS_BUCKETS) {
        const { env } = makeEnv();
        const body = JSON.stringify({ name: "app_open", props: { userType, progressBucket } });
        const res = await handleEvent(post(body), env, NOW);
        expect(res.status, `${userType} ${progressBucket}`).toBe(204);
      }
    }
  });

  it("refuses any other shape with 400 and writes nothing", async () => {
    const bad = [
      "not json",
      "null",
      "[]",
      "{}",
      '"app_open"',
      JSON.stringify({ name: "page_view", props: { userType: "new", progressBucket: "0" } }),
      JSON.stringify({ name: "app_open" }),
      JSON.stringify({ name: "app_open", props: null }),
      JSON.stringify({ name: "app_open", props: [] }),
      JSON.stringify({ name: "app_open", props: { userType: "new" } }),
      JSON.stringify({ name: "app_open", props: { userType: "admin", progressBucket: "0" } }),
      JSON.stringify({ name: "app_open", props: { userType: "new", progressBucket: "42" } }),
      JSON.stringify({ name: "app_open", props: { userType: "new", progressBucket: 0 } }),
      // An extra key is refused, so nothing else can ride along.
      JSON.stringify({
        name: "app_open",
        props: { userType: "new", progressBucket: "0", userId: "u1" },
      }),
      JSON.stringify({
        name: "app_open",
        props: { userType: "new", progressBucket: "0" },
        page: "/settings",
      }),
    ];
    for (const body of bad) {
      const { env, d1, rl } = makeEnv();
      const res = await handleEvent(post(body), env, NOW);
      expect(res.status, body).toBe(400);
      expect(d1.calls, body).toHaveLength(0);
      expect(rl.keys, body).toHaveLength(0);
    }
  });

  it("refuses a 201-byte body with 400", async () => {
    const { env, d1 } = makeEnv();
    const padded = GOOD.slice(0, -1) + ',"pad":"' + "x".repeat(201 - GOOD.length - 9) + '"}';
    expect(new TextEncoder().encode(padded).length).toBe(201);
    const res = await handleEvent(post(padded), env, NOW);
    expect(res.status).toBe(400);
    expect(d1.calls).toHaveLength(0);
  });

  it("refuses a declared Content-Length over the limit before reading the body", async () => {
    const { env, d1 } = makeEnv();
    const req = post(GOOD);
    req.headers.set("Content-Length", "5000");
    const res = await handleEvent(req, env, NOW);
    expect(res.status).toBe(400);
    expect(d1.calls).toHaveLength(0);
  });

  it("refuses another origin, or none, with 403", async () => {
    for (const origin of ["https://evil.example", null, "http://pokememory.com"]) {
      const { env, d1 } = makeEnv();
      const res = await handleEvent(post(GOOD, origin), env, NOW);
      expect(res.status, String(origin)).toBe(403);
      expect(d1.calls).toHaveLength(0);
    }
  });

  it("refuses GET with 405", async () => {
    const { env, d1 } = makeEnv();
    const res = await handleEvent(post("", APP, "GET"), env, NOW);
    expect(res.status).toBe(405);
    expect(d1.calls).toHaveLength(0);
  });

  it("rate-limits by event name, never IP: a refusal gets 429 and no write", async () => {
    const { env, d1, rl } = makeEnv({ allow: false });
    const req = post(GOOD);
    req.headers.set("CF-Connecting-IP", "203.0.113.7");
    const res = await handleEvent(req, env, NOW);
    expect(res.status).toBe(429);
    expect(d1.calls).toHaveLength(0);
    expect(rl.keys).toEqual(["app_open"]);
  });

  it("gives 503 when the database fails", async () => {
    const { env } = makeEnv({ failDb: true });
    const res = await handleEvent(post(GOOD), env, NOW);
    expect(res.status).toBe(503);
  });

  it("never sets a cookie and never lets a response be cached", async () => {
    const cases: Array<[Request, { allow?: boolean; failDb?: boolean }]> = [
      [post(GOOD), {}],
      [post("{}"), {}],
      [post(GOOD, "https://evil.example"), {}],
      [post("", APP, "GET"), {}],
      [post(GOOD), { allow: false }],
      [post(GOOD), { failDb: true }],
    ];
    for (const [req, opts] of cases) {
      const { env } = makeEnv(opts);
      const res = await handleEvent(req, env, NOW);
      expect(res.headers.get("Set-Cookie"), `status ${res.status}`).toBeNull();
      expect(res.headers.get("Cache-Control"), `status ${res.status}`).toBe("no-store");
    }
  });
});

describe("sendEvent", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });

  it("beacons the event as JSON to /api/event", async () => {
    const sent: Array<{ url: string; data: Blob }> = [];
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        sendBeacon(url: string, data: Blob) {
          sent.push({ url, data });
          return true;
        },
      },
    });
    sendEvent("app_open", { userType: "new", progressBucket: "0" });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/event");
    expect(sent[0].data.type).toBe("application/json");
    expect(await sent[0].data.text()).toBe(GOOD);
  });

  it("does nothing and does not throw without navigator.sendBeacon", () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    expect(() => sendEvent("app_open", { userType: "new", progressBucket: "0" })).not.toThrow();
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined });
    expect(() => sendEvent("app_open", { userType: "new", progressBucket: "0" })).not.toThrow();
  });

  it("does not throw when sendBeacon itself throws", () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        sendBeacon() {
          throw new TypeError("Illegal invocation");
        },
      },
    });
    expect(() => sendEvent("app_open", { userType: "new", progressBucket: "0" })).not.toThrow();
  });
});
