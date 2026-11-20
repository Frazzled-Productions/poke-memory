/**
 * Allowlist of the per-user tables lib/db/scope.ts may touch (design D4), with
 * each column's type so values convert both ways and look like the rows
 * supabase-js returned (0/1 to booleans, JSON text to objects).
 *
 * Every identifier scope.ts puts in SQL comes from here: a table or column not
 * listed is refused (42P01 / 42703) before any SQL runs. A test
 * (lib/db/tables.test.ts) keeps this file in step with db/d1/migrations.
 *
 * Tables reached only by system jobs (rate_limit_buckets) and Better Auth's
 * tables are deliberately absent: they
 * have no per-user scope and go through lib/db/system.ts or Better Auth.
 */
import { DbError } from "./errors";

/**
 * text: TEXT as is. int / real: numbers. bool: 0/1 in SQL, boolean in rows.
 * json: TEXT in SQL, parsed value in rows. timestamp: ISO 8601 UTC text,
 * normalised on write. date: 'YYYY-MM-DD' text, normalised on write.
 */
export type ColumnType = "text" | "int" | "real" | "bool" | "json" | "timestamp" | "date";

export interface TableDef {
  readonly name: ScopedTableName;
  /** The column pinned to the session user on every read and write. */
  readonly userColumn: "user_id";
  readonly columns: Readonly<Record<string, ColumnType>>;
  readonly primaryKey: readonly string[];
  /**
   * The column sets an upsert may name in onConflict (PRIMARY KEY or UNIQUE).
   * Each includes the user column, so a conflict can only ever be with one of
   * the caller's own rows. The first is the default when onConflict is omitted.
   */
  readonly conflictKeys: readonly (readonly string[])[];
  /** Reachable from the browser through POST /api/db (design D5). */
  readonly gateway: boolean;
}

export type ScopedTableName =
  | "card_reviews"
  | "user_settings"
  | "streak_days"
  | "grade_log"
  | "push_subscriptions"
  | "feedback";

export const TABLES: Readonly<Record<ScopedTableName, TableDef>> = {
  card_reviews: {
    name: "card_reviews",
    userColumn: "user_id",
    columns: {
      id: "text",
      user_id: "text",
      card_type: "text",
      subject_key: "text",
      locale: "text",
      due_date: "date",
      last_review: "date",
      first_seen: "date",
      updated_at: "timestamp",
      stability: "real",
      difficulty: "real",
      elapsed_days: "int",
      scheduled_days: "int",
      reps: "int",
      lapses: "int",
      fsrs_state: "text",
      hidden_since: "date",
      seen_in_pasture: "bool",
    },
    primaryKey: ["user_id", "card_type", "subject_key", "locale"],
    conflictKeys: [["user_id", "card_type", "subject_key", "locale"]],
    gateway: true,
  },
  user_settings: {
    name: "user_settings",
    userColumn: "user_id",
    columns: {
      user_id: "text",
      settings: "json",
      updated_at: "timestamp",
      timezone: "text",
      date_format: "text",
      last_reset_at: "timestamp",
      push_notification_hour: "int",
    },
    primaryKey: ["user_id"],
    conflictKeys: [["user_id"]],
    gateway: true,
  },
  streak_days: {
    name: "streak_days",
    userColumn: "user_id",
    columns: { id: "text", user_id: "text", review_date: "date" },
    primaryKey: ["id"],
    conflictKeys: [["user_id", "review_date"]],
    gateway: true,
  },
  grade_log: {
    name: "grade_log",
    userColumn: "user_id",
    columns: {
      id: "text",
      user_id: "text",
      occurred_at: "int",
      entry_date: "date",
      card_type: "text",
      grade: "int",
      subject_key: "text",
      locale: "text",
      learning_step: "int",
      step_started_at: "int",
    },
    primaryKey: ["id"],
    conflictKeys: [["user_id", "occurred_at"]],
    gateway: true,
  },
  push_subscriptions: {
    name: "push_subscriptions",
    userColumn: "user_id",
    columns: {
      id: "text",
      user_id: "text",
      endpoint: "text",
      p256dh: "text",
      auth_secret: "text",
      created_at: "timestamp",
      last_seen_at: "timestamp",
    },
    primaryKey: ["id"],
    conflictKeys: [["user_id", "endpoint"]],
    gateway: true,
  },
  feedback: {
    name: "feedback",
    userColumn: "user_id",
    columns: {
      id: "text",
      user_id: "text",
      category: "text",
      message: "text",
      page: "text",
      app_version: "text",
      created_at: "timestamp",
    },
    primaryKey: ["id"],
    conflictKeys: [],
    gateway: false,
  },
};

/**
 * Every table holding per-user or auth data, for the CI rule
 * (scripts/check-scoped-queries.mjs keeps its own copy; a test compares them).
 * SQL naming one of these may only live in lib/db/ (design D4).
 */
export const PROTECTED_TABLES = [
  "card_reviews",
  "user_settings",
  "streak_days",
  "grade_log",
  "push_subscriptions",
  "feedback",
  "rate_limit_buckets",
  "user",
  "session",
  "account",
] as const;

export function getTable(name: string): TableDef {
  if (!Object.prototype.hasOwnProperty.call(TABLES, name)) {
    throw new DbError("42P01", `relation "${name}" is not available`);
  }
  return TABLES[name as ScopedTableName];
}

export function columnType(table: TableDef, column: string): ColumnType {
  if (!Object.prototype.hasOwnProperty.call(table.columns, column)) {
    throw new DbError("42703", `column ${table.name}.${column} does not exist`);
  }
  return table.columns[column];
}
