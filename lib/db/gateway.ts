/**
 * The data gateway behind POST /api/db (design D5): the browser's data client
 * (lib/db/client.ts) serialises each supabase-js style query to JSON, and this
 * module validates it and runs it through the scope helper, pinned to the
 * session user. It can do no more than the browser could under Supabase RLS,
 * and less: only the tables, operations and columns the app uses.
 *
 * Wire format (request body, JSON). Unknown keys anywhere are refused.
 *
 *   { kind: "select", table, columns?, filters?, order?, range?: [from, to],
 *     limit?, count?: "exact", head?: boolean, single?: "maybe" | "one" }
 *   { kind: "upsert", table, rows, onConflict?, ignoreDuplicates? }
 *   { kind: "insert", table, rows }
 *   { kind: "update", table, values, filters? }
 *   { kind: "delete", table, filters? }
 *   { kind: "rpc", name, args? }
 *
 *   columns: "*" or a list of column names.
 *   filters: [{ column, op, value }], ANDed; op is one of eq, neq, gt, gte,
 *            lt, lte, in (value: array), is, not-is (value: null, true, false).
 *   order:   [{ column, ascending?, nullsFirst? }].
 *   rows:    one object or a list (at most MAX_WRITE_ROWS).
 *
 * Response body, like supabase-js: { data, error, count }, where error is
 * { code, message, details, hint } with Postgres-style codes
 * (lib/db/errors.ts), so the client's existing handling of error.code (the
 * 23514 rejections, the 42xxx structural errors) is unchanged.
 *
 *   200  ran (a database error such as 23514 is 200 with `error` set)
 *   400  malformed query, unknown table, column, operator or RPC (42601,
 *        42P01, 42703, 42883, 42P10) or a value of the wrong type (22P02)
 *   403  a row, filter or argument names another user, or the operation or
 *        column is not open to the browser (42501)
 *   401  no session (the route answers this before calling in)
 *
 * Writes return data: null (the app never asks for the written rows back).
 */
import type { D1DatabaseLike } from "./d1";
import { DbError, isDbError, toDbError } from "./errors";
import { forUser, type Filter, type FilterOp, type OrderBy, type Row } from "./scope";
import { TABLES, type ScopedTableName } from "./tables";
import { mergeUserSettings, type Json } from "./rpc/mergeUserSettings";
import { resetAllProgress } from "./rpc/resetAllProgress";
import { deleteAccount } from "./rpc/deleteAccount";

/** Largest request body the route accepts. */
export const MAX_BODY_BYTES = 1_000_000;
/** Most rows in one insert or upsert (pushSession and the grade-log re-push send 200). */
export const MAX_WRITE_ROWS = 500;
/** Most rows one select may ask for (fetchAllPages pages by 1000, the PostgREST cap). */
export const MAX_SELECT_ROWS = 1000;
/** Most values in one `in` filter. */
export const MAX_IN_VALUES = 1000;
export const MAX_FILTERS = 16;
export const MAX_ORDER = 4;

export type GatewayTable = "card_reviews" | "user_settings" | "streak_days" | "grade_log" | "push_subscriptions";
export type GatewayRpc = "merge_user_settings" | "reset_all_progress" | "delete_account";

interface TablePolicy {
  select: boolean;
  /** Columns an insert or upsert row may carry (user_id is always allowed and pinned). */
  insert?: readonly string[];
  upsert?: readonly string[];
  /** Columns an update may set. */
  update?: readonly string[];
  delete?: boolean;
  /**
   * Upserts are always ON CONFLICT DO NOTHING, whatever the request says: the
   * table is append-only (Postgres 018 dropped grade_log's UPDATE and DELETE
   * policies), so a repeated entry can never rewrite a stored one.
   */
  appendOnly?: boolean;
}

const CARD_WRITE_COLUMNS = [
  "card_type",
  "subject_key",
  "locale",
  "due_date",
  "last_review",
  "first_seen",
  "stability",
  "difficulty",
  "elapsed_days",
  "scheduled_days",
  "reps",
  "lapses",
  "fsrs_state",
  "hidden_since",
  "seen_in_pasture",
];

/**
 * What the browser may do per table: the operations the app's call sites use,
 * within what RLS allowed. Server-set columns (id, updated_at, created_at)
 * are never client-written. user_settings.settings and last_reset_at are
 * written only by the RPCs, so the 038 guard and the reset tombstone cannot be
 * sidestepped with a plain update.
 */
const POLICY: Readonly<Record<GatewayTable, TablePolicy>> = {
  card_reviews: { select: true, upsert: CARD_WRITE_COLUMNS },
  user_settings: { select: true, update: ["timezone", "date_format", "push_notification_hour"] },
  streak_days: { select: true, upsert: ["review_date"], appendOnly: true },
  grade_log: {
    select: true,
    appendOnly: true,
    upsert: ["occurred_at", "entry_date", "card_type", "grade", "subject_key", "locale", "learning_step", "step_started_at"],
  },
  push_subscriptions: { select: true, insert: ["endpoint", "p256dh", "auth_secret", "last_seen_at"], delete: true },
};

const FILTER_OPS: ReadonlySet<string> = new Set<FilterOp>(["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "not-is"]);

export interface GatewayError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

export interface GatewayResponseBody {
  data: unknown;
  error: GatewayError | null;
  count?: number | null;
}

export interface GatewayResult {
  status: number;
  body: GatewayResponseBody;
}

/** A malformed request: answered 400 before anything runs. */
class BadRequest extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new BadRequest("42601", `${where}: unknown key "${key}"`);
  }
}

function gatewayTable(name: unknown): GatewayTable {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(POLICY, name)) {
    throw new BadRequest("42P01", `relation "${String(name)}" is not available`);
  }
  return name as GatewayTable;
}

function knownColumn(table: GatewayTable, column: unknown): string {
  if (typeof column !== "string" || !Object.prototype.hasOwnProperty.call(TABLES[table as ScopedTableName].columns, column)) {
    throw new BadRequest("42703", `column ${table}.${String(column)} does not exist`);
  }
  return column;
}

function nonNegativeInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequest("42601", `${name} must be a non-negative integer`);
  }
  return value;
}

function parseFilters(table: GatewayTable, raw: unknown): Filter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FILTERS) {
    throw new BadRequest("42601", `filters must be a list of at most ${MAX_FILTERS}`);
  }
  return raw.map((f) => {
    if (!isPlainObject(f)) throw new BadRequest("42601", "each filter must be an object");
    onlyKeys(f, ["column", "op", "value"], "filter");
    const column = knownColumn(table, f.column);
    if (typeof f.op !== "string" || !FILTER_OPS.has(f.op)) {
      throw new BadRequest("42883", `unknown operator ${String(f.op)}`);
    }
    if (!("value" in f)) throw new BadRequest("42601", `filter on ${column} has no value`);
    if (f.op === "in" && (!Array.isArray(f.value) || f.value.length > MAX_IN_VALUES)) {
      throw new BadRequest("42601", `in takes a list of at most ${MAX_IN_VALUES} values`);
    }
    return { column, op: f.op as FilterOp, value: f.value };
  });
}

function parseColumns(table: GatewayTable, raw: unknown): string[] | "*" {
  if (raw === undefined || raw === "*") return "*";
  if (!Array.isArray(raw) || raw.length === 0) throw new BadRequest("42601", "columns must be \"*\" or a list");
  return raw.map((c) => knownColumn(table, c));
}

function parseOrder(table: GatewayTable, raw: unknown): OrderBy[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ORDER) {
    throw new BadRequest("42601", `order must be a list of at most ${MAX_ORDER}`);
  }
  return raw.map((o) => {
    if (!isPlainObject(o)) throw new BadRequest("42601", "each order must be an object");
    onlyKeys(o, ["column", "ascending", "nullsFirst"], "order");
    const column = knownColumn(table, o.column);
    for (const flag of ["ascending", "nullsFirst"] as const) {
      if (o[flag] !== undefined && typeof o[flag] !== "boolean") {
        throw new BadRequest("42601", `order.${flag} must be a boolean`);
      }
    }
    return { column, ascending: o.ascending as boolean | undefined, nullsFirst: o.nullsFirst as boolean | undefined };
  });
}

function parseRows(table: GatewayTable, raw: unknown, allowed: readonly string[]): Row[] {
  const rows = Array.isArray(raw) ? raw : [raw];
  if (rows.length === 0 || rows.length > MAX_WRITE_ROWS) {
    throw new BadRequest("42601", `rows must be 1 to ${MAX_WRITE_ROWS} objects`);
  }
  return rows.map((row) => {
    if (!isPlainObject(row)) throw new BadRequest("42601", "each row must be an object");
    for (const key of Object.keys(row)) {
      knownColumn(table, key);
      if (key !== "user_id" && !allowed.includes(key)) {
        throw new BadRequest("42501", `${table}.${key} cannot be written from the browser`);
      }
    }
    return row;
  });
}

function bool(raw: unknown, name: string): boolean {
  if (raw === undefined) return false;
  if (typeof raw !== "boolean") throw new BadRequest("42601", `${name} must be a boolean`);
  return raw;
}

function refuse(table: GatewayTable, operation: string): never {
  throw new BadRequest("42501", `${operation} on ${table} is not allowed from the browser`);
}

// ── Execution ───────────────────────────────────────────────────────────────

const BAD_REQUEST_CODES = new Set(["42601", "42P01", "42703", "42883", "42P10", "22P02", "22007", "54000"]);

function errorBody(code: string, message: string, details: string | null = null, hint: string | null = null) {
  return { data: null, error: { code, message, details, hint } };
}

function failure(err: unknown): GatewayResult {
  if (err instanceof BadRequest) {
    return { status: err.code === "42501" ? 403 : 400, body: errorBody(err.code, err.message) };
  }
  const dbError = isDbError(err) ? err : toDbError(err);
  const status = dbError.code === "42501" ? 403 : BAD_REQUEST_CODES.has(dbError.code) ? 400 : 200;
  if (dbError.code === "XX000") console.error("[api/db] database error", dbError.message);
  return { status, body: errorBody(dbError.code, dbError.message, dbError.details, dbError.hint) };
}

async function runSelect(db: D1DatabaseLike, userId: string, q: Record<string, unknown>): Promise<GatewayResult> {
  onlyKeys(q, ["kind", "table", "columns", "filters", "order", "range", "limit", "count", "head", "single"], "select");
  const table = gatewayTable(q.table);
  if (!POLICY[table].select) refuse(table, "select");
  const columns = parseColumns(table, q.columns);
  const filters = parseFilters(table, q.filters);
  const order = parseOrder(table, q.order);
  if (q.count !== undefined && q.count !== "exact") throw new BadRequest("42601", "count must be \"exact\"");
  const head = bool(q.head, "head");
  if (q.single !== undefined && q.single !== "maybe" && q.single !== "one") {
    throw new BadRequest("42601", "single must be \"maybe\" or \"one\"");
  }

  let offset = 0;
  let limit = MAX_SELECT_ROWS;
  if (q.range !== undefined) {
    if (!Array.isArray(q.range) || q.range.length !== 2) throw new BadRequest("42601", "range must be [from, to]");
    const from = nonNegativeInt(q.range[0], "range from");
    const to = nonNegativeInt(q.range[1], "range to");
    if (to < from || to - from + 1 > MAX_SELECT_ROWS) {
      throw new BadRequest("42601", `range must cover 1 to ${MAX_SELECT_ROWS} rows`);
    }
    offset = from;
    limit = to - from + 1;
  }
  if (q.limit !== undefined) {
    const n = nonNegativeInt(q.limit, "limit");
    if (n > MAX_SELECT_ROWS) throw new BadRequest("42601", `limit may be at most ${MAX_SELECT_ROWS}`);
    limit = Math.min(limit, n);
  }

  const scoped = forUser(db, userId);
  const count = q.count === "exact" ? await scoped.count(table, filters) : null;
  if (head) return { status: 200, body: { data: null, error: null, count } };

  // single: fetch one row more than allowed, to tell "one" from "several".
  const rows = await scoped.select(table, {
    columns,
    filters,
    order,
    offset,
    limit: q.single ? Math.min(limit, 2) : limit,
  });
  if (q.single) {
    if (rows.length > 1 || (q.single === "one" && rows.length === 0)) {
      return {
        status: 406,
        body: {
          ...errorBody(
            "PGRST116",
            "JSON object requested, multiple (or no) rows returned",
            `The result contains ${rows.length > 1 ? "more than one" : "0"} rows`,
          ),
          count,
        },
      };
    }
    return { status: 200, body: { data: rows[0] ?? null, error: null, count } };
  }
  return { status: 200, body: { data: rows, error: null, count } };
}

async function runWrite(db: D1DatabaseLike, userId: string, q: Record<string, unknown>): Promise<GatewayResult> {
  const scoped = forUser(db, userId);
  switch (q.kind) {
    case "upsert": {
      onlyKeys(q, ["kind", "table", "rows", "onConflict", "ignoreDuplicates"], "upsert");
      const table = gatewayTable(q.table);
      const allowed = POLICY[table].upsert ?? refuse(table, "upsert");
      const rows = parseRows(table, q.rows, allowed);
      if (q.onConflict !== undefined && typeof q.onConflict !== "string") {
        throw new BadRequest("42601", "onConflict must be a comma-separated string");
      }
      await scoped.upsert(table, rows, {
        onConflict: q.onConflict as string | undefined,
        ignoreDuplicates: bool(q.ignoreDuplicates, "ignoreDuplicates") || POLICY[table].appendOnly === true,
      });
      break;
    }
    case "insert": {
      onlyKeys(q, ["kind", "table", "rows"], "insert");
      const table = gatewayTable(q.table);
      const allowed = POLICY[table].insert ?? refuse(table, "insert");
      await scoped.insert(table, parseRows(table, q.rows, allowed));
      break;
    }
    case "update": {
      onlyKeys(q, ["kind", "table", "values", "filters"], "update");
      const table = gatewayTable(q.table);
      const allowed = POLICY[table].update ?? refuse(table, "update");
      if (Array.isArray(q.values)) throw new BadRequest("42601", "update values must be one object");
      const [values] = parseRows(table, q.values, allowed);
      await scoped.update(table, values, parseFilters(table, q.filters));
      break;
    }
    case "delete": {
      onlyKeys(q, ["kind", "table", "filters"], "delete");
      const table = gatewayTable(q.table);
      if (!POLICY[table].delete) refuse(table, "delete");
      await scoped.delete(table, parseFilters(table, q.filters));
      break;
    }
  }
  return { status: 200, body: { data: null, error: null } };
}

async function runRpc(db: D1DatabaseLike, userId: string, q: Record<string, unknown>): Promise<GatewayResult> {
  onlyKeys(q, ["kind", "name", "args"], "rpc");
  const args = q.args === undefined || q.args === null ? {} : q.args;
  if (!isPlainObject(args)) throw new BadRequest("42601", "args must be an object");
  switch (q.name) {
    case "merge_user_settings": {
      onlyKeys(args, ["p_user_id", "p_patch"], "merge_user_settings");
      // The id is accepted for the old call shape but must be the caller's own.
      if (args.p_user_id !== undefined && args.p_user_id !== userId) {
        throw new DbError("42501", "merge_user_settings: p_user_id names another user");
      }
      const patch = args.p_patch;
      if (patch !== undefined && patch !== null && !isPlainObject(patch)) {
        throw new BadRequest("22P02", "merge_user_settings: p_patch must be a JSON object");
      }
      await mergeUserSettings(db, userId, patch as Json | undefined);
      return { status: 200, body: { data: null, error: null } };
    }
    case "reset_all_progress":
      onlyKeys(args, [], "reset_all_progress");
      await resetAllProgress(db, userId);
      return { status: 200, body: { data: null, error: null } };
    case "delete_account": {
      onlyKeys(args, [], "delete_account");
      await deleteAccount(db, userId);
      return { status: 200, body: { data: null, error: null } };
    }
    default:
      throw new BadRequest("42883", `function ${String(q.name)} is not available`);
  }
}

/**
 * Validates and runs one gateway request for the session user. Never throws:
 * every failure is a GatewayResult with the status and body to send.
 */
export async function handleGatewayRequest(
  db: D1DatabaseLike,
  sessionUserId: string,
  request: unknown,
): Promise<GatewayResult> {
  try {
    if (!isPlainObject(request)) throw new BadRequest("42601", "the request must be a JSON object");
    switch (request.kind) {
      case "select":
        return await runSelect(db, sessionUserId, request);
      case "upsert":
      case "insert":
      case "update":
      case "delete":
        return await runWrite(db, sessionUserId, request);
      case "rpc":
        return await runRpc(db, sessionUserId, request);
      default:
        throw new BadRequest("42601", `unknown kind ${String(request.kind)}`);
    }
  } catch (err) {
    return failure(err);
  }
}
