#!/usr/bin/env node
// Compare local db/migrations/*.sql files against the migrations the
// Supabase project has actually applied. Exits non-zero on drift.
//
// Used by the migration-check GitHub Actions job to catch "I forgot to
// apply this migration" before it ships. See #309.
//
// Required env vars:
//   SUPABASE_ACCESS_TOKEN — personal access token with read access to the
//     project's database. In CI this comes from a repo secret.
//   SUPABASE_PROJECT_REF  — the project ref (the slug in the dashboard URL).

import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "db", "migrations");

// Migration 001 was applied via the Supabase dashboard during project
// bootstrap (before the apply_migration MCP workflow existed), so it does
// not appear in the API's list of applied migrations. Skip it.
const EXEMPT_FILENAMES = new Set(["001_initial_sync_schema.sql"]);

function derivedName(filename) {
  // filename: "002_card_reviews_regression_trigger.sql"
  // derived:  "card_reviews_regression_trigger"
  return filename.replace(/^\d+_/, "").replace(/\.sql$/, "");
}

async function listLocalMigrations() {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith(".sql") && !EXEMPT_FILENAMES.has(f))
    .sort()
    .map((filename) => ({ filename, name: derivedName(filename) }));
}

async function listAppliedMigrations(projectRef, token) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/migrations`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `Supabase Management API responded ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  const body = await res.json();
  // The Management API has returned both a bare array and a `{migrations:
  // [...]}` envelope across versions / wrappers. Handle either.
  const arr = Array.isArray(body) ? body : body.migrations;
  if (!Array.isArray(arr)) {
    throw new Error(
      `Unexpected response shape — expected an array of migrations, got: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return arr.map((m) => m.name);
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set. Cannot check migrations.");
    process.exit(2);
  }
  if (!projectRef) {
    console.error("SUPABASE_PROJECT_REF is not set. Cannot check migrations.");
    process.exit(2);
  }

  const local = await listLocalMigrations();
  const applied = new Set(await listAppliedMigrations(projectRef, token));

  const missing = local.filter((m) => !applied.has(m.name));

  if (missing.length === 0) {
    console.log(`OK — all ${local.length} local migration(s) are applied to ${projectRef}.`);
    return;
  }

  console.error(
    `DRIFT — the following migration file(s) are committed but NOT applied to ${projectRef}:`,
  );
  for (const m of missing) {
    console.error(`  - ${m.filename} (name="${m.name}")`);
  }
  console.error("");
  console.error(
    "Apply each missing migration via `mcp__supabase__apply_migration` (Claude Code),",
  );
  console.error("the Supabase dashboard SQL Editor, or `supabase db push` locally.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
