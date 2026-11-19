/**
 * Read-only test helpers for asserting on rows that have no scoped read
 * (system tables), so tests outside lib/db hold no SQL (scripts/check-scoped-queries.mjs).
 */
import type { SqliteD1 } from "./sqliteD1";

/** How many stored Discord post ids (feedback_discord_posts) there are. */
export function countDiscordPosts(d1: SqliteD1): number {
  const row = d1.sqlite.prepare("SELECT COUNT(*) AS n FROM feedback_discord_posts").get() as { n: number };
  return Number(row.n);
}

/** Every ip_hash recorded in rate_limit_buckets, oldest first. */
export function rateLimitIpHashes(d1: SqliteD1): string[] {
  const rows = d1.sqlite.prepare("SELECT ip_hash FROM rate_limit_buckets ORDER BY attempted_at").all() as {
    ip_hash: string;
  }[];
  return rows.map((r) => r.ip_hash);
}
