/**
 * Integration test: all migrations apply cleanly against a fresh Postgres DB.
 *
 * This is the primary guard against the #444 / pokemon_id NOT NULL class of
 * bug: a syntax error, a column-rename conflict, or a type mismatch in any
 * migration file fails this test at PR time.
 *
 * The test applies every file in db/migrations/ in numeric order using the
 * same `applyMigrations` helper used by the regression-trigger and RLS tests.
 * A clean apply (no exceptions thrown) is the only assertion - the schema
 * shape tests are the responsibility of the individual feature tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestDatabase,
  dropTestDatabase,
  applyPreMigrationFixture,
} from "./setup";
import { applyMigrations, listMigrationFiles } from "./applyMigrations";
import pg from "pg";

let pool: pg.Pool;
let dbName: string;

beforeAll(async () => {
  ({ pool, dbName } = await createTestDatabase());
  await applyPreMigrationFixture(pool);
}, 30_000);

afterAll(async () => {
  await dropTestDatabase(pool, dbName);
});

describe("apply-migrations (integration)", () => {
  it("all migrations in db/migrations/ apply without error", async () => {
    // If any migration fails, applyMigrations throws with the filename.
    await expect(applyMigrations(pool)).resolves.toBeUndefined();
  });

  it("migration files are sorted in strict numeric order with no unexpected duplicates", () => {
    // listMigrationFiles() throws if it detects a new duplicate prefix.
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    // Verify ascending order.
    for (let i = 1; i < files.length; i++) {
      const prev = files[i - 1];
      const curr = files[i];
      const prevNum = parseInt(/^(\d+)_/.exec(prev)?.[1] ?? "0", 10);
      const currNum = parseInt(/^(\d+)_/.exec(curr)?.[1] ?? "0", 10);
      expect(
        currNum >= prevNum,
        `Migration ${curr} (prefix ${currNum}) must come after ${prev} (prefix ${prevNum})`,
      ).toBe(true);
    }
  });
});
