// Run one read-only SQL query against the production D1 database (binding `DB` in wrangler.jsonc)
// with `wrangler d1 execute --remote --json`, for the scheduled monitors that used to call the
// Supabase Management API (refresh-user-count, the grade_log divergence check).
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment and wrangler installed
// (`npm ci`). The workflows skip with a notice before calling this when the token is absent.

import { execFileSync } from "node:child_process";

/**
 * Pull the rows of the last statement out of `wrangler d1 execute --json` output, which is an
 * array with one `{ results, success, meta }` entry per statement.
 * @param {string} stdout
 * @returns {Record<string, unknown>[]}
 */
export function parseWranglerJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`wrangler did not print JSON: ${stdout.slice(0, 200)}`);
  }
  const statements = Array.isArray(parsed) ? parsed : [parsed];
  const last = statements.at(-1);
  if (!last || last.success !== true || !Array.isArray(last.results)) {
    throw new Error(`Unexpected wrangler result: ${stdout.slice(0, 200)}`);
  }
  return last.results;
}

/**
 * @param {string} sql One statement.
 * @returns {Record<string, unknown>[]}
 */
export function queryD1(sql) {
  const stdout = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--remote", "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 },
  );
  return parseWranglerJson(stdout);
}
