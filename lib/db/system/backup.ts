/**
 * The backup job's reads (design D10): which tables exist, in an order a
 * restore can insert them in, and their rows.
 *
 * Only importable from the cron, push-send, Discord and feedback routes and
 * lib/db (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { DbError } from "../errors";
import { all } from "./query";

/**
 * Every table in db/d1/migrations, in restore order: parents before the rows
 * that reference them ("user" first), and card_reviews, streak_days and
 * grade_log before user_settings, because their pre-reset triggers (022)
 * compare each insert with user_settings.last_reset_at. A test keeps this
 * list equal to the migrated schema.
 */
export const BACKUP_TABLE_ORDER = [
  "user",
  "session",
  "account",
  "verification",
  "card_reviews",
  "streak_days",
  "grade_log",
  "user_settings",
  "push_subscriptions",
  "feedback",
  "feedback_discord_posts",
  "rate_limit_buckets",
] as const;

/**
 * The tables to back up: BACKUP_TABLE_ORDER first, then any table added by a
 * later migration and not yet listed (sorted by name), so a new table is
 * never left out of the file. SQLite's own tables, Cloudflare's (_cf_) and
 * D1's migration log are skipped.
 */
export async function backupTables(db: D1DatabaseLike): Promise<{ tables: string[]; unlisted: string[] }> {
  const rows = await all<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
        AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name <> 'd1_migrations'
      ORDER BY name`,
  );
  const present = new Set(rows.map((r) => r.name));
  const listed: string[] = BACKUP_TABLE_ORDER.filter((t) => present.has(t));
  const unlisted = rows.map((r) => r.name).filter((t) => !(BACKUP_TABLE_ORDER as readonly string[]).includes(t));
  return { tables: [...listed, ...unlisted], unlisted };
}

const PAGE_SIZE = 1000;

/**
 * Reads one table page by page in rowid order, calling `onPage` with the
 * column names and each page's rows (values as stored). `table` must come
 * from backupTables.
 */
export async function readTablePages(
  db: D1DatabaseLike,
  table: string,
  onPage: (columns: string[], rows: unknown[][]) => void,
): Promise<void> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new DbError("42P01", `bad table name: ${table}`);
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let page: unknown[][];
    try {
      page = await db
        .prepare(`SELECT * FROM "${table}" ORDER BY rowid LIMIT ? OFFSET ?`)
        .bind(PAGE_SIZE, offset)
        .raw({ columnNames: true });
    } catch (err) {
      throw new DbError("XX000", `reading ${table} failed`, { cause: err });
    }
    const [columns, ...rows] = page as [string[], ...unknown[][]];
    if (rows.length > 0) onPage(columns, rows);
    if (rows.length < PAGE_SIZE) return;
  }
}
