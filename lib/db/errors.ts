/**
 * Database errors with Postgres-style codes (design D4), so the client's
 * existing rejection and structural-error handling (lib/sync/structuralError.ts)
 * keeps working after the move from Supabase to D1. `toJSON()` has the shape
 * of a supabase-js PostgrestError: { code, message, details, hint }.
 *
 * Codes used:
 *   23514 check_violation        a guard trigger (RAISE 'check_violation: ...') or CHECK
 *   23505 unique_violation       UNIQUE or PRIMARY KEY
 *   23503 foreign_key_violation  FOREIGN KEY
 *   23502 not_null_violation     NOT NULL
 *   42703 undefined_column       unknown column (allowlist or SQLite)
 *   42P01 undefined_table        unknown table (allowlist or SQLite)
 *   42P10 invalid_column_reference  onConflict matches no allowed key
 *   42501 insufficient_privilege a row or filter naming another user; the
 *                                gateway maps it to HTTP 403
 *   42883 undefined_function     an operator the column type does not support
 *   22P02 invalid_text_representation  a value of the wrong type
 *   22007 invalid_datetime_format       an unparseable date or timestamp
 *   54000 program_limit_exceeded more than D1's 100 bound parameters
 *   40001 serialization_failure  the settings merge lost its compare-and-swap
 *                                five times (lib/db/rpc/mergeUserSettings.ts)
 *   P0001 raise_exception        reset_all_progress cooldown (migration 026)
 *   XX000 internal_error         anything else
 */

export type DbErrorCode =
  | "23514"
  | "23505"
  | "23503"
  | "23502"
  | "42703"
  | "42P01"
  | "42P10"
  | "42501"
  | "42883"
  | "22P02"
  | "22007"
  | "54000"
  | "40001"
  | "P0001"
  | "XX000";

export interface DbErrorJson {
  code: DbErrorCode;
  message: string;
  details: string | null;
  hint: string | null;
}

export class DbError extends Error {
  readonly code: DbErrorCode;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(
    code: DbErrorCode,
    message: string,
    options: { details?: string | null; hint?: string | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DbError";
    this.code = code;
    this.details = options.details ?? null;
    this.hint = options.hint ?? null;
  }

  toJSON(): DbErrorJson {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

export function isDbError(err: unknown): err is DbError {
  return err instanceof DbError;
}

/** The marker every guard trigger in db/d1/migrations puts before its message. */
export const CHECK_VIOLATION_PREFIX = "check_violation: ";

const RULES: { pattern: RegExp; code: DbErrorCode }[] = [
  { pattern: /check_violation: /, code: "23514" },
  { pattern: /CHECK constraint failed/i, code: "23514" },
  { pattern: /UNIQUE constraint failed/i, code: "23505" },
  { pattern: /FOREIGN KEY constraint failed/i, code: "23503" },
  { pattern: /NOT NULL constraint failed/i, code: "23502" },
  { pattern: /no such column|has no column named/i, code: "42703" },
  { pattern: /no such table/i, code: "42P01" },
  { pattern: /too many SQL variables/i, code: "54000" },
];

/** Strips D1's wrapping ("D1_ERROR: ...: SQLITE_CONSTRAINT") and the guard marker. */
function cleanMessage(raw: string): string {
  let message = raw.replace(/^(D1_[A-Z_]+:\s*)+/, "").replace(/:\s*SQLITE_[A-Z_]+$/, "");
  const marker = message.indexOf(CHECK_VIOLATION_PREFIX);
  if (marker >= 0) message = message.slice(marker + CHECK_VIOLATION_PREFIX.length);
  return message.trim();
}

/**
 * Maps anything thrown by D1 (or by the node:sqlite test shim) to a DbError.
 * A DbError passes through unchanged.
 */
export function toDbError(err: unknown): DbError {
  if (err instanceof DbError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const rule = RULES.find((r) => r.pattern.test(raw));
  return new DbError(rule?.code ?? "XX000", cleanMessage(raw), { cause: err });
}
