// @ts-check
/**
 * The triggers the D1 migrations leave in place, read from the migration SQL
 * (moved from scripts/cloudflare/copy-from-supabase.mjs so the copy script and
 * the backup tests share it). Plain JavaScript so a Node script can import it
 * without a build step.
 */

/**
 * Every trigger the migrations leave in place, as [name, verbatim CREATE
 * TRIGGER statement], in migration order. A later DROP TRIGGER removes one.
 *
 * @param {readonly string[]} migrationSql Each migration file's text, in apply order.
 * @returns {[string, string][]}
 */
export function parseMigrationTriggers(migrationSql) {
  /** @type {Map<string, string>} */
  const triggers = new Map();
  const pattern =
    /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?("?)(\w+)\1[\s\S]*?\bEND\s*;|DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?("?)(\w+)\3\s*;/gi;
  for (const sql of migrationSql) {
    for (const m of sql.matchAll(pattern)) {
      if (m[2]) triggers.set(m[2], m[0]);
      else triggers.delete(m[4]);
    }
  }
  return [...triggers.entries()];
}
