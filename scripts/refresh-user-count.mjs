#!/usr/bin/env node
// Count the accounts in the production D1 database (Better Auth's `user` table) and write a
// Shields.io-compatible JSON file to `.github/stats/users.json`.
//
// Used by `.github/workflows/refresh-user-count.yml` to keep the README badge fresh. See #400.
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (read by wrangler, scripts/cloudflare/d1-query.mjs).

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { queryD1 } from "./cloudflare/d1-query.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(REPO_ROOT, ".github", "stats");
const OUTPUT_PATH = join(OUTPUT_DIR, "users.json");

function fetchUserCount() {
  const rows = queryD1('SELECT COUNT(*) AS n FROM "user"');
  if (rows.length === 0 || typeof rows[0].n !== "number") {
    throw new Error(`Unexpected result - expected [{ n: <number> }], got: ${JSON.stringify(rows).slice(0, 200)}`);
  }
  return rows[0].n;
}

async function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error("CLOUDFLARE_API_TOKEN is not set.");
    process.exit(2);
  }

  const count = fetchUserCount();

  const payload = {
    schemaVersion: 1,
    label: "users",
    message: String(count),
    color: "blue",
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`Wrote ${OUTPUT_PATH} (count=${count}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
