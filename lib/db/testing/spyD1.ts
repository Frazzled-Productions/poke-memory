/**
 * Wraps a D1 test database so a route test can see which tables each
 * statement touches, fail chosen statements, or hold them back. For tests
 * outside lib/db, which may not call prepare()/batch() themselves
 * (scripts/check-scoped-queries.mjs).
 *
 *   const db = spyD1(createSqliteD1(), {
 *     before: ({ table }) => { if (table === "grade_log") throw new Error("down"); },
 *   });
 *   ...
 *   expect(db.calls.map((c) => c.table)).toEqual(["card_reviews"]);
 */
import type { D1DatabaseLike, D1PreparedStatementLike } from "../d1";

export interface SpiedStatement {
  /** The first table the statement names (INSERT INTO / FROM / UPDATE / DELETE FROM). */
  table: string | null;
  sql: string;
  /** Statements in the same batch() call (1 for a single statement). */
  batchSize: number;
}

export interface SpyHooks {
  /** Runs before each statement executes; throw to fail it, await to hold it back. */
  before?: (statement: SpiedStatement) => void | Promise<void>;
}

export type SpiedD1 = D1DatabaseLike & { calls: SpiedStatement[] };

const TABLE = /\b(?:INTO|FROM|UPDATE)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i;

export function spyD1(inner: D1DatabaseLike, hooks: SpyHooks = {}): SpiedD1 {
  const calls: SpiedStatement[] = [];
  const sqlOf = new WeakMap<D1PreparedStatementLike, string>();

  function track(statement: D1PreparedStatementLike, sql: string): D1PreparedStatementLike {
    sqlOf.set(statement, sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => track(bind(...values), sql);
    for (const method of ["all", "run", "first", "raw"] as const) {
      const original = (statement[method] as (...args: unknown[]) => Promise<unknown>).bind(statement);
      (statement as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
        await record([sql]);
        return original(...args);
      };
    }
    return statement;
  }

  async function record(sqls: string[]) {
    for (const sql of sqls) {
      const entry = { table: TABLE.exec(sql)?.[1] ?? null, sql, batchSize: sqls.length };
      calls.push(entry);
      await hooks.before?.(entry);
    }
  }

  return {
    calls,
    prepare: (query) => track(inner.prepare(query), query),
    async batch(statements) {
      await record(statements.map((s) => sqlOf.get(s) ?? ""));
      return inner.batch(statements);
    },
    exec: (query) => inner.exec(query),
  };
}
