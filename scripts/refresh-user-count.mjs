#!/usr/bin/env node
// Query the live Supabase project for the current `auth.users` count and
// write a Shields.io-compatible JSON file to `.github/stats/users.json`.
//
// Used by `.github/workflows/refresh-user-count.yml` to keep the README
// badge fresh. See #400.
//
// Required env vars:
//   SUPABASE_ACCESS_TOKEN - personal access token with read access to the
//     project's database. In CI this comes from the repo secret of the
//     same name (already used by migration-check.yml).
//   SUPABASE_PROJECT_REF - the project ref (the slug in the dashboard URL).

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = join(REPO_ROOT, ".github", "stats");
const OUTPUT_PATH = join(OUTPUT_DIR, "users.json");

async function fetchUserCount(projectRef, token) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: "select count(*)::int as n from auth.users" }),
  });
  if (!res.ok) {
    throw new Error(
      `Supabase Management API responded ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  const body = await res.json();
  const rows = Array.isArray(body) ? body : body.result;
  if (!Array.isArray(rows) || rows.length === 0 || typeof rows[0].n !== "number") {
    throw new Error(
      `Unexpected response shape - expected [{ n: <number> }], got: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return rows[0].n;
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set.");
    process.exit(2);
  }
  if (!projectRef) {
    console.error("SUPABASE_PROJECT_REF is not set.");
    process.exit(2);
  }

  const count = await fetchUserCount(projectRef, token);

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
