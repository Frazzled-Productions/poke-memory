/**
 * Integration test: the real `/api/sync` route against the real `card_reviews`
 * table, regression trigger and CHECK constraints (#2206).
 *
 * The Supabase client is replaced by a thin adapter that issues what PostgREST
 * issues for `upsert(rows, { onConflict })`: one multi-row
 * `INSERT ... ON CONFLICT DO UPDATE` statement, returning the SQLSTATE as
 * `error.code`. Everything else (the route, the trigger) is real.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
  insertAuthUser,
} from "./setup";
import { applyMigrations } from "./applyMigrations";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { POST } from "@/app/api/sync/route";
import { createClient } from "@/lib/supabase/server";

let pool: pg.Pool;
let dbName: string;
const USER_ID = randomUUID();

/** Subject keys whose next single-row upsert fails once with a transient error. */
const failOnce = new Set<string>();

type Row = Record<string, unknown>;

async function upsert(payload: Row | Row[], { onConflict }: { onConflict: string }) {
  const rows = Array.isArray(payload) ? payload : [payload];
  if (!Array.isArray(payload) && failOnce.delete(String(payload.subject_key))) {
    return { error: { code: "57014", message: "statement timeout" } };
  }
  const cols = Object.keys(rows[0]);
  const placeholders = rows.map(
    (_, r) => `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(", ")})`,
  );
  const conflict = onConflict.split(",");
  const updates = cols.filter((c) => !conflict.includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
  try {
    await pool.query(
      `INSERT INTO card_reviews (${cols.join(", ")}) VALUES ${placeholders.join(", ")}
       ON CONFLICT (${conflict.join(", ")}) DO UPDATE SET ${updates.join(", ")}`,
      rows.flatMap((row) => cols.map((c) => row[c])),
    );
    return { error: null };
  } catch (err) {
    const { code, message } = err as { code: string; message: string };
    return { error: { code, message } };
  }
}

function card(subject_key: string, overrides: Row = {}): Row {
  return {
    card_type: "name",
    subject_key,
    locale: "en",
    stability: 1.5,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 3,
    reps: 2,
    lapses: 0,
    fsrs_state: "review",
    due_date: "2026-05-20",
    last_review: "2026-05-17",
    first_seen: "2026-05-10",
    hidden_since: null,
    ...overrides,
  };
}

/** A card the cloud already holds at a later review, so this copy is stale. */
const stale = (key: string) => card(key, { reps: 1, last_review: "2026-05-10" });

function post(cards: Row[]): Promise<Response> {
  return POST(
    new Request("http://localhost/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards }),
    }),
  );
}

async function cloudReps(key: string): Promise<number | undefined> {
  const { rows } = await pool.query(
    `SELECT reps FROM card_reviews WHERE user_id = $1 AND subject_key = $2`,
    [USER_ID, key],
  );
  return rows[0]?.reps;
}

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
  await applyMigrations(pool);
  await insertAuthUser(pool, USER_ID);
}, 60_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

beforeEach(async () => {
  failOnce.clear();
  await pool.query(`DELETE FROM card_reviews WHERE user_id = $1`, [USER_ID]);
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: () => ({ upsert }),
  } as never);
  expect((await post([card("1")])).status).toBe(200); // the cloud holds card 1
});

describe("/api/sync per-row results (integration)", () => {
  it("a queue holding one stale card returns 200 and leaves the cloud row alone", async () => {
    const res = await post([stale("1")]);

    expect(res.status).toBe(200);
    expect(await cloudReps("1")).toBe(2);
  });

  it("a stale card does not block a good card beside it", async () => {
    const res = await post([stale("1"), card("2")]);

    expect(res.status).toBe(200);
    expect(await cloudReps("2")).toBe(2);
  });

  it("a transient row failure returns 502, and replaying the same queue lands the row", async () => {
    const queue = [stale("1"), card("2"), card("3")];
    failOnce.add("3");

    expect((await post(queue)).status).toBe(502);
    expect(await cloudReps("3")).toBeUndefined();

    expect((await post(queue)).status).toBe(200);
    expect(await cloudReps("3")).toBe(2);
  });

  it("a row outside a table CHECK is also 23514, so it is evicted like a stale card", async () => {
    const res = await post([card("2", { difficulty: 11 })]);

    expect(res.status).toBe(200);
    expect(await cloudReps("2")).toBeUndefined();
  });
});
