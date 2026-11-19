/**
 * A D1Database-compatible test double over node:sqlite (built into Node 24),
 * with db/d1/migrations applied. For unit tests of anything that takes a D1
 * binding: lib/db/scope.ts, routes, RPC ports, the backup job.
 *
 *   const d1 = createSqliteD1();          // fresh in-memory database, migrated
 *   const alice = createTestUser(d1);     // a Better Auth "user" row
 *   await forUser(d1, alice).insert("streak_days", { review_date: "2026-11-19" });
 *   d1.close();
 *
 * Behaviour matching D1: statements are compiled on first use (so a bad table
 * fails at all()/run(), not at prepare()), booleans bind as 1/0, undefined is
 * refused, foreign keys are enforced, batch() is atomic (one transaction) and
 * errors carry D1's "D1_ERROR: " prefix. Not modelled: D1's 100-parameter
 * limit (lib/db/scope.ts enforces it), sessions, Time Travel.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "../d1";

export const D1_MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/d1/migrations", import.meta.url));

export interface SqliteD1 extends D1DatabaseLike {
  /** The underlying database, for test set-up and assertions. */
  readonly sqlite: DatabaseSync;
  close(): void;
}

export interface CreateSqliteD1Options {
  /** Apply db/d1/migrations (default true). */
  migrate?: boolean;
  /** Apply migrations whose file name sorts at or before this one. */
  through?: string;
  migrationsDir?: string;
}

/** Applies every `*.sql` file in name order; returns the file names applied. */
export function applyD1Migrations(
  sqlite: DatabaseSync,
  { through, migrationsDir = D1_MIGRATIONS_DIR }: Omit<CreateSqliteD1Options, "migrate"> = {},
): string[] {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => through === undefined || f <= through);
  for (const file of files) sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  return files;
}

function d1Error(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`D1_ERROR: ${message}`, { cause: err });
}

function toInput(value: unknown, index: number): SQLInputValue {
  if (value === undefined) {
    throw new Error(`D1_TYPE_ERROR: Type 'undefined' not supported for value at index ${index}`);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as SQLInputValue;
}

class Statement implements D1PreparedStatementLike {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values.map(toInput));
  }

  /** Runs synchronously; used by batch() inside its transaction. */
  execute<T>(): D1ResultLike<T> {
    const started = performance.now();
    let compiled: StatementSync;
    try {
      compiled = this.sqlite.prepare(this.sql);
    } catch (err) {
      throw d1Error(err);
    }
    try {
      let results: T[] = [];
      let changes = 0;
      let lastRowId = 0;
      if (compiled.columns().length > 0) {
        results = compiled.all(...this.params).map((r) => ({ ...r }) as T);
        // For INSERT/UPDATE/DELETE ... RETURNING, changes() is the last statement's count.
        changes = Number((this.sqlite.prepare("SELECT changes() AS n").get() as { n: number }).n);
      } else {
        const info = compiled.run(...this.params);
        changes = Number(info.changes);
        lastRowId = Number(info.lastInsertRowid);
      }
      return {
        results,
        success: true,
        meta: { changes, last_row_id: lastRowId, duration: performance.now() - started, changed_db: changes > 0 },
      };
    } catch (err) {
      throw d1Error(err);
    }
  }

  async all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return this.execute<T>();
  }

  async run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>> {
    return this.execute<T>();
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const [row] = this.execute<Record<string, unknown>>().results;
    if (!row) return null;
    if (colName === undefined) return row as T;
    if (!(colName in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${colName})`);
    return row[colName] as T;
  }

  async raw<T = unknown[]>(options: { columnNames?: boolean } = {}): Promise<T[]> {
    const { results } = this.execute<Record<string, unknown>>();
    const columns = this.sqlite.prepare(this.sql).columns().map((c) => c.name);
    const rows = results.map((r) => columns.map((c) => r[c]) as T);
    return options.columnNames ? [columns as T, ...rows] : rows;
  }
}

/** A fresh in-memory D1 stand-in, migrated unless `migrate: false`. */
export function createSqliteD1(options: CreateSqliteD1Options = {}): SqliteD1 {
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  if (options.migrate !== false) applyD1Migrations(sqlite, options);

  return {
    sqlite,
    close: () => sqlite.close(),
    prepare: (query) => new Statement(sqlite, query),
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatementLike[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => {
          if (!(s instanceof Statement)) throw new Error("D1_ERROR: batch() takes statements from prepare()");
          return s.execute<T>();
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(query) {
      const started = performance.now();
      try {
        sqlite.exec(query);
      } catch (err) {
        throw d1Error(err);
      }
      const count = query.split(";").filter((part) => part.trim() !== "").length;
      return { count, duration: performance.now() - started };
    },
  };
}

/**
 * Inserts a Better Auth "user" row (0002_auth.sql) and returns its id, so rows
 * referencing "user"(id) satisfy their foreign key.
 */
export function createTestUser(
  d1: SqliteD1,
  fields: { id?: string; username?: string | null; email?: string } = {},
): string {
  const id = fields.id ?? randomUUID();
  const now = new Date().toISOString();
  d1.sqlite
    .prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, username)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(id, fields.username ?? "test user", fields.email ?? `${id}@example.test`, now, now, fields.username ?? null);
  return id;
}
