/**
 * The scope helper: the only way app code reads or writes per-user rows in D1.
 * It replaces Supabase row-level security (decision 0018, design D4).
 *
 *   const db = forUser(await getDb(), session.user.id);
 *   const rows = await db.select("card_reviews", {
 *     columns: ["card_type", "subject_key", "due_date"],
 *     filters: [{ column: "locale", op: "eq", value: "en" }],
 *     order: [{ column: "subject_key" }],
 *     limit: 1000,
 *   });
 *
 * Guarantees:
 *   - Every statement carries `user_id = ?` bound to `userId`; every written row
 *     has its user_id set to `userId`.
 *   - A row, update or filter naming any other user is refused with DbError
 *     code 42501 (the gateway answers 403) before any SQL runs.
 *   - Every table and column name is checked against lib/db/tables.ts (42P01 /
 *     42703) and every value is bound, never interpolated.
 *   - Values convert both ways per column type, so rows look like supabase-js
 *     rows: booleans, parsed JSON, ISO timestamps.
 *   - insert and upsert of many rows run as one atomic db.batch() with one
 *     statement per row (D1 allows 100 bound parameters per statement), like
 *     one Postgres statement. An `in` filter binds its list as one JSON
 *     parameter, so it has no length limit.
 *   - Errors are DbError with Postgres-style codes (lib/db/errors.ts).
 */
import type { D1DatabaseLike, D1PreparedStatementLike } from "./d1";
import { DbError, toDbError } from "./errors";
import { columnType, getTable, type ColumnType, type TableDef } from "./tables";

export type Row = Record<string, unknown>;

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "not-is";

/**
 * One condition, ANDed with the others. `in` takes an array; `is` / `not-is`
 * take null, true or false (SQL IS / IS NOT); the rest take one non-null value.
 */
export interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}

export interface OrderBy {
  column: string;
  /** Default true. */
  ascending?: boolean;
  /** Default as Postgres: nulls last when ascending, first when descending. */
  nullsFirst?: boolean;
}

export interface SelectQuery {
  /** Default "*": every column in tables.ts. */
  columns?: readonly string[] | "*";
  filters?: readonly Filter[];
  order?: readonly OrderBy[];
  offset?: number;
  limit?: number;
}

export interface WriteOptions {
  /** Columns to return from the written rows; omitted: returns []. */
  returning?: readonly string[] | "*";
}

export interface UpsertOptions extends WriteOptions {
  /**
   * The conflict target, as a comma-separated string (supabase-js style) or a
   * list. Must equal one of the table's conflictKeys; default the first.
   */
  onConflict?: string | readonly string[];
  /** ON CONFLICT DO NOTHING instead of updating the existing row. */
  ignoreDuplicates?: boolean;
}

export interface InsertOptions extends WriteOptions {
  /**
   * As supabase-js: with several rows, columns missing from a row are written
   * as NULL (true, the default) or left to the column default (false).
   */
  defaultToNull?: boolean;
}

export interface ScopedDb {
  readonly userId: string;
  select(table: string, query?: SelectQuery): Promise<Row[]>;
  count(table: string, filters?: readonly Filter[]): Promise<number>;
  insert(table: string, rows: Row | readonly Row[], options?: InsertOptions): Promise<Row[]>;
  upsert(
    table: string,
    rows: Row | readonly Row[],
    options?: UpsertOptions & InsertOptions,
  ): Promise<Row[]>;
  update(
    table: string,
    values: Row,
    filters: readonly Filter[],
    options?: WriteOptions,
  ): Promise<Row[]>;
  delete(table: string, filters: readonly Filter[], options?: WriteOptions): Promise<Row[]>;
}

/** D1's limit on bound parameters per statement. */
export const MAX_BOUND_PARAMETERS = 100;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function quote(identifier: string): string {
  // Names come from tables.ts; the pattern check is a second fence.
  if (!IDENTIFIER.test(identifier)) {
    throw new DbError("42703", `invalid identifier "${identifier}"`);
  }
  return `"${identifier}"`;
}

function wrongType(column: string, type: ColumnType, value: unknown): DbError {
  return new DbError("22P02", `invalid input for ${type} column ${column}: ${JSON.stringify(value)}`);
}

/** A JS value to the SQL value stored in a column of `type`. */
export function toSqlValue(column: string, type: ColumnType, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "text":
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      throw wrongType(column, type, value);
    case "int":
    case "real": {
      const n =
        typeof value === "number"
          ? value
          : typeof value === "string" && value.trim() !== ""
            ? Number(value)
            : NaN;
      if (!Number.isFinite(n) || (type === "int" && !Number.isInteger(n))) {
        throw wrongType(column, type, value);
      }
      return n;
    }
    case "bool":
      if (value === true || value === 1 || value === "true") return 1;
      if (value === false || value === 0 || value === "false") return 0;
      throw wrongType(column, type, value);
    case "json":
      return JSON.stringify(value);
    case "timestamp": {
      const ms =
        value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
      if (Number.isNaN(ms)) {
        throw new DbError("22007", `invalid timestamp for ${column}: ${JSON.stringify(value)}`);
      }
      return new Date(ms).toISOString();
    }
    case "date": {
      const match = typeof value === "string" ? /^\d{4}-\d{2}-\d{2}/.exec(value) : null;
      if (!match) throw new DbError("22007", `invalid date for ${column}: ${JSON.stringify(value)}`);
      return match[0];
    }
  }
}

/** A SQL value read from a column of `type` to the value supabase-js returned. */
export function fromSqlValue(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === "bool") return value === 1 || value === true;
  if (type === "json" && typeof value === "string") return JSON.parse(value);
  return value;
}

function decodeRow(table: TableDef, row: Row): Row {
  const out: Row = {};
  for (const [column, value] of Object.entries(row)) {
    out[column] = fromSqlValue(table.columns[column], value);
  }
  return out;
}

function resolveColumns(table: TableDef, columns: readonly string[] | "*" | undefined): string[] {
  if (columns === undefined || columns === "*") return Object.keys(table.columns);
  if (columns.length === 0) throw new DbError("42703", "no columns selected");
  for (const column of columns) columnType(table, column);
  return [...columns];
}

function returningClause(table: TableDef, returning: readonly string[] | "*" | undefined): string {
  if (returning === undefined) return "";
  return ` RETURNING ${resolveColumns(table, returning).map(quote).join(", ")}`;
}

function otherUser(table: TableDef): DbError {
  return new DbError("42501", `${table.name}: a row or filter names another user`);
}

class Compiler {
  readonly params: (string | number | null)[] = [];
  constructor(
    private readonly table: TableDef,
    private readonly userId: string,
  ) {}

  bind(value: string | number | null): string {
    this.params.push(value);
    return "?";
  }

  /** `user_id = ?` plus each filter, ANDed. */
  where(filters: readonly Filter[] = []): string {
    const parts = [`${quote(this.table.userColumn)} = ${this.bind(this.userId)}`];
    for (const filter of filters) {
      const part = this.filter(filter);
      if (part) parts.push(part);
    }
    return ` WHERE ${parts.join(" AND ")}`;
  }

  private filter({ column, op, value }: Filter): string | null {
    const type = columnType(this.table, column);
    if (column === this.table.userColumn) {
      // Already pinned by the first condition; only a restatement of it passes.
      const values = op === "in" && Array.isArray(value) ? value : [value];
      if ((op !== "eq" && op !== "in") || values.length === 0 || values.some((v) => v !== this.userId)) {
        throw otherUser(this.table);
      }
      return null;
    }
    const col = quote(column);
    if (type === "json" && op !== "is" && op !== "not-is") {
      throw new DbError("42883", `operator ${op} is not supported on json column ${column}`);
    }
    switch (op) {
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        if (value === null || value === undefined) {
          throw new DbError("22P02", `${op} needs a value for ${column}; use "is" for null`);
        }
        const sqlOp = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
        return `${col} ${sqlOp} ${this.bind(toSqlValue(column, type, value))}`;
      }
      case "in": {
        if (!Array.isArray(value)) throw new DbError("22P02", `in needs an array for ${column}`);
        const list = value.map((v) => {
          if (v === null || v === undefined) throw new DbError("22P02", `in cannot match null in ${column}`);
          return toSqlValue(column, type, v);
        });
        return `${col} IN (SELECT value FROM json_each(${this.bind(JSON.stringify(list))}))`;
      }
      case "is":
      case "not-is": {
        const not = op === "not-is" ? " NOT" : "";
        if (value === null) return `${col} IS${not} NULL`;
        if (value === true || value === false) return `${col} IS${not} ${value ? 1 : 0}`;
        throw new DbError("22P02", `${op} takes null, true or false for ${column}`);
      }
      default:
        throw new DbError("42883", `unknown operator ${String(op)}`);
    }
  }

  checkLimit(): void {
    if (this.params.length > MAX_BOUND_PARAMETERS) {
      throw new DbError("54000", `statement needs ${this.params.length} bound parameters; D1 allows ${MAX_BOUND_PARAMETERS}`);
    }
  }
}

function normaliseRows(rows: Row | readonly Row[]): readonly Row[] {
  return Array.isArray(rows) ? rows : [rows as Row];
}

function parseConflict(table: TableDef, onConflict: string | readonly string[] | undefined): string[] {
  const requested =
    onConflict === undefined
      ? [...(table.conflictKeys[0] ?? [])]
      : (typeof onConflict === "string" ? onConflict.split(",") : [...onConflict]).map((c) => c.trim());
  const match = table.conflictKeys.find(
    (key) => key.length === requested.length && key.every((c) => requested.includes(c)),
  );
  if (!match || requested.length === 0) {
    throw new DbError(
      "42P10",
      `${table.name}: no unique constraint matches ON CONFLICT (${requested.join(", ")})`,
    );
  }
  return requested;
}

export function forUser(db: D1DatabaseLike, userId: string): ScopedDb {
  if (typeof userId !== "string" || userId === "") {
    throw new DbError("42501", "forUser needs the session user's id");
  }

  async function run(statements: D1PreparedStatementLike[]): Promise<Row[][]> {
    try {
      const results = await db.batch<Row>(statements);
      return results.map((r) => r.results ?? []);
    } catch (err) {
      throw toDbError(err);
    }
  }

  function prepare(sql: string, compiler: Compiler): D1PreparedStatementLike {
    compiler.checkLimit();
    return db.prepare(sql).bind(...compiler.params);
  }

  /** Encodes one row for writing, pinning the user column. */
  function encodeRow(table: TableDef, row: Row, columns: readonly string[], defaultToNull: boolean) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new DbError("22P02", `${table.name}: each row must be an object`);
    }
    const owner = row[table.userColumn];
    if (owner !== undefined && owner !== userId) throw otherUser(table);
    const names: string[] = [];
    const values: (string | number | null)[] = [];
    for (const column of columns) {
      if (column === table.userColumn) continue;
      const present = Object.prototype.hasOwnProperty.call(row, column) && row[column] !== undefined;
      if (!present && !defaultToNull) continue;
      names.push(column);
      values.push(present ? toSqlValue(column, table.columns[column], row[column]) : null);
    }
    names.push(table.userColumn);
    values.push(userId);
    return { names, values };
  }

  /** Union of the rows' keys (supabase-js does the same), each checked. */
  function columnsOf(table: TableDef, rows: readonly Row[]): string[] {
    const seen = new Set<string>();
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue;
      for (const [key, value] of Object.entries(row)) {
        if (value === undefined) continue;
        columnType(table, key);
        seen.add(key);
      }
    }
    return [...seen];
  }

  async function write(
    tableName: string,
    input: Row | readonly Row[],
    options: (UpsertOptions & InsertOptions) | undefined,
    conflict: "insert" | "upsert",
  ): Promise<Row[]> {
    const table = getTable(tableName);
    const rows = normaliseRows(input);
    if (rows.length === 0) return [];
    const columns = columnsOf(table, rows);
    const defaultToNull = options?.defaultToNull ?? true;
    const conflictColumns = conflict === "upsert" ? parseConflict(table, options?.onConflict) : [];
    const returning = returningClause(table, options?.returning);

    const statements = rows.map((row) => {
      const { names, values } = encodeRow(table, row, columns, defaultToNull);
      const compiler = new Compiler(table, userId);
      const placeholders = values.map((v) => compiler.bind(v)).join(", ");
      let sql = `INSERT INTO ${quote(table.name)} (${names.map(quote).join(", ")}) VALUES (${placeholders})`;
      if (conflict === "upsert") {
        const target = conflictColumns.map(quote).join(", ");
        const updates = names.filter((n) => !conflictColumns.includes(n));
        sql +=
          options?.ignoreDuplicates || updates.length === 0
            ? ` ON CONFLICT (${target}) DO NOTHING`
            : ` ON CONFLICT (${target}) DO UPDATE SET ${updates
                .map((n) => `${quote(n)} = excluded.${quote(n)}`)
                .join(", ")}`;
      }
      return prepare(sql + returning, compiler);
    });
    const results = await run(statements);
    return results.flat().map((r) => decodeRow(table, r));
  }

  return {
    userId,

    async select(tableName, query = {}) {
      const table = getTable(tableName);
      const columns = resolveColumns(table, query.columns);
      const compiler = new Compiler(table, userId);
      let sql = `SELECT ${columns.map(quote).join(", ")} FROM ${quote(table.name)}`;
      sql += compiler.where(query.filters);
      if (query.order?.length) {
        sql += ` ORDER BY ${query.order
          .map(({ column, ascending = true, nullsFirst = !ascending }) => {
            columnType(table, column);
            return `${quote(column)} ${ascending ? "ASC" : "DESC"} NULLS ${nullsFirst ? "FIRST" : "LAST"}`;
          })
          .join(", ")}`;
      }
      for (const [name, n] of [["limit", query.limit], ["offset", query.offset]] as const) {
        if (n !== undefined && (!Number.isInteger(n) || n < 0)) {
          throw new DbError("22P02", `${name} must be a non-negative integer`);
        }
      }
      if (query.limit !== undefined || query.offset !== undefined) {
        sql += ` LIMIT ${query.limit ?? -1} OFFSET ${query.offset ?? 0}`;
      }
      const [rows] = await run([prepare(sql, compiler)]);
      return rows.map((r) => decodeRow(table, r));
    },

    async count(tableName, filters = []) {
      const table = getTable(tableName);
      const compiler = new Compiler(table, userId);
      const sql = `SELECT count(*) AS n FROM ${quote(table.name)}${compiler.where(filters)}`;
      const [rows] = await run([prepare(sql, compiler)]);
      return Number(rows[0]?.n ?? 0);
    },

    insert(tableName, rows, options) {
      return write(tableName, rows, options, "insert");
    },

    upsert(tableName, rows, options) {
      return write(tableName, rows, options, "upsert");
    },

    async update(tableName, values, filters, options) {
      const table = getTable(tableName);
      if (values === null || typeof values !== "object" || Array.isArray(values)) {
        throw new DbError("22P02", `${table.name}: update values must be an object`);
      }
      const owner = values[table.userColumn];
      if (owner !== undefined && owner !== userId) throw otherUser(table);
      const compiler = new Compiler(table, userId);
      const sets: string[] = [];
      for (const [column, value] of Object.entries(values)) {
        if (value === undefined || column === table.userColumn) continue;
        const type = columnType(table, column);
        sets.push(`${quote(column)} = ${compiler.bind(toSqlValue(column, type, value))}`);
      }
      if (sets.length === 0) return [];
      const sql =
        `UPDATE ${quote(table.name)} SET ${sets.join(", ")}` +
        compiler.where(filters) +
        returningClause(table, options?.returning);
      const [rows] = await run([prepare(sql, compiler)]);
      return rows.map((r) => decodeRow(table, r));
    },

    async delete(tableName, filters, options) {
      const table = getTable(tableName);
      const compiler = new Compiler(table, userId);
      const sql =
        `DELETE FROM ${quote(table.name)}` +
        compiler.where(filters) +
        returningClause(table, options?.returning);
      const [rows] = await run([prepare(sql, compiler)]);
      return rows.map((r) => decodeRow(table, r));
    },
  };
}
