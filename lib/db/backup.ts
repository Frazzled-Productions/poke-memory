/**
 * The nightly D1 backup (design D10): every table as SQL INSERT statements,
 * written to R2 at `d1/YYYY-MM-DD.sql`, then objects older than 90 days
 * deleted. Run by POST /api/cron/backup at 02:00 UTC.
 *
 * File format (scripts/cloudflare/check-restore.mjs parses the header):
 *
 *   -- poke-memory D1 backup 2026-11-20T02:00:03.120Z
 *   -- rows user: 21
 *   -- rows card_reviews: 4812
 *   ... one `-- rows <table>: <count>` line for every table, empty ones too
 *   INSERT INTO "user" ("id", "name", ...) VALUES (...);
 *
 *   DROP TRIGGER IF EXISTS "card_reviews_reject_regression_trigger";
 *   ... every trigger, then one INSERT per row ...
 *   CREATE TRIGGER card_reviews_reject_regression_trigger ... END;
 *
 * A restore applies db/d1/migrations to a fresh database first, then runs the
 * file with `wrangler d1 execute --file`. Tables come in BACKUP_TABLE_ORDER,
 * parents first. The file drops the database's triggers before the rows and
 * recreates them verbatim after, so rows go back exactly as stored: rows the
 * copy from Supabase kept with triggers bypassed (more than 10 push rows for
 * one user, a streak date in the future) are neither trimmed nor refused, and
 * push_subscriptions.last_seen_at keeps its value. No PRAGMA or transaction
 * statements.
 */
import type { D1DatabaseLike, R2BucketLike } from "./d1";
import { backupTables, databaseTriggers, readTablePages } from "./system/backup";

export const BACKUP_PREFIX = "d1/";
export const BACKUP_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_DATE = /^d1\/(\d{4}-\d{2}-\d{2})\.sql$/;

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** One stored value as an SQL literal. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot back up the number ${value}`);
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `X'${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  if (Array.isArray(value)) return sqlLiteral(Uint8Array.from(value as number[]));
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The whole database as backup SQL, with the row-count header. */
export async function dumpDatabase(db: D1DatabaseLike, now: Date = new Date()): Promise<{
  sql: string;
  counts: Record<string, number>;
}> {
  const { tables, unlisted } = await backupTables(db);
  if (unlisted.length > 0) {
    console.warn(`[backup] tables missing from BACKUP_TABLE_ORDER, dumped last: ${unlisted.join(", ")}`);
  }
  const counts: Record<string, number> = {};
  const statements: string[] = [];
  for (const table of tables) {
    counts[table] = 0;
    await readTablePages(db, table, (columns, rows) => {
      const prefix = `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (`;
      for (const row of rows) {
        statements.push(`${prefix}${row.map(sqlLiteral).join(", ")});`);
      }
      counts[table] += rows.length;
    });
  }
  const triggers = await databaseTriggers(db);
  const header = [
    `-- poke-memory D1 backup ${now.toISOString()}`,
    ...tables.map((t) => `-- rows ${t}: ${counts[t]}`),
  ];
  return {
    sql:
      [
        ...header,
        ...triggers.map((t) => `DROP TRIGGER IF EXISTS ${quoteIdentifier(t.name)};`),
        ...statements,
        ...triggers.map((t) => `${t.sql};`),
      ].join("\n") + "\n",
    counts,
  };
}

export function backupKey(now: Date): string {
  return `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.sql`;
}

/**
 * Deletes the backups whose key date is more than BACKUP_RETENTION_DAYS
 * before `now`'s UTC date. Keys that are not `d1/YYYY-MM-DD.sql` are kept.
 */
export async function pruneBackups(bucket: R2BucketLike, now: Date = new Date()): Promise<string[]> {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const cutoff = today - BACKUP_RETENTION_DAYS * DAY_MS;
  const expired: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
    for (const { key } of page.objects) {
      const match = KEY_DATE.exec(key);
      if (match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff) expired.push(key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // R2 deletes up to 1000 keys per call.
  for (let i = 0; i < expired.length; i += 1000) {
    await bucket.delete(expired.slice(i, i + 1000));
  }
  return expired;
}

export type BackupResult = {
  key: string;
  bytes: number;
  counts: Record<string, number>;
  pruned: string[];
};

/** Dumps the database to `bucket`, then prunes old backups. */
export async function runBackup(
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  now: Date = new Date(),
): Promise<BackupResult> {
  const { sql, counts } = await dumpDatabase(db, now);
  const key = backupKey(now);
  await bucket.put(key, sql, { httpMetadata: { contentType: "application/sql; charset=utf-8" } });
  const pruned = await pruneBackups(bucket, now);
  return { key, bytes: new TextEncoder().encode(sql).byteLength, counts, pruned };
}
