#!/usr/bin/env node
//
// Monitor: grade_log vs card_reviews divergence (closes #607, #1047)
//
// Why this exists
// ---------------
// The #584 incident — signed-in users grading cards without producing
// card_reviews rows — went unnoticed for ~24 hours because the only signal
// was a client-side `console.warn`. This script catches the same class of
// failure from the data side: if a user's grade_log shows a card was graded
// in the last 48h but their card_reviews table has no row for that card at
// all, sync is broken for them.
//
// What the metric measures (#1047)
// --------------------------------
// `grade_log` records one row per grade event (every Again/Hard/Good/Easy
// tap, including learning-step replays). `card_reviews` records one row
// per (user_id, card_type, subject_key) tuple — i.e. one row per *card*,
// not per grade.
//
// The #584 signature is precise: a grade_log subject that has NO matching
// card_reviews row at all. If a card was ever graded successfully its
// card_reviews row exists permanently — the row is upserted, never deleted
// by sync. So the only way a recently-graded subject has no card_reviews
// row is that the card_reviews write never landed: exactly the #584 break.
//
// The earlier metric (pre-#1047) compared distinct grade_log subjects in
// the window against `card_reviews` rows whose `first_seen` fell in the
// same window. That was wrong: established SRS users review *mature* cards
// every day, and a mature card's `first_seen` is weeks or months in the
// past. Those legitimate daily reviews produced a non-zero `gap` purely
// because the card was first seen outside the window — a benign false
// positive (#1046, #970). The corrected metric joins on existence of the
// card_reviews row regardless of `first_seen`, so mature-card reviews no
// longer count as divergence.
//
// card_type normalisation (#970)
// ------------------------------
// grade_log and card_reviews use different card_type conventions for
// evolution-stream cards. The grade_log write path (lib/sync/gradeLog.ts)
// stores the raw app type — 'evolution' / 'reverse-evolution' — while the
// card_reviews push path runs appTypeToDbType (lib/sync/cloud.ts), which
// rewrites those to the '-edge' suffixed forms 'evolution-edge' /
// 'reverse-evolution-edge'. Joining on the raw grade_log card_type would
// make every evolution-stream card look "missing" from card_reviews and
// inflate the divergence count, producing false #584-shape alerts. The
// CASE below replicates appTypeToDbType on the grade_log side so the join
// is expressed in the same card_type vocabulary as card_reviews. All other
// card types (name / reverse / cry) are identical across both tables and
// pass through unchanged.
//
// Required env vars
// -----------------
//   SUPABASE_ACCESS_TOKEN — Management API personal access token (same
//     secret already used by refresh-user-count.yml and migration-check).
//   SUPABASE_PROJECT_REF  — project ref slug.
//   DIVERGENCE_THRESHOLD  — optional, integer, default 0. With the
//     corrected existence metric every missing subject is a real #584
//     signal, so the default is 0: alert on any non-zero count. The env
//     var remains an escape hatch for temporarily muting a known-noisy
//     run, but it should not normally be set above 0.
//
// Output contract
// ---------------
//   * If no users diverge: writes "OK" to stdout, exit 0.
//   * If one or more users diverge: writes a JSON object to stdout of the
//     shape { users: [{ user_id_prefix, missing_subjects }, ...] } plus
//     metadata, and exit 0. We never exit non-zero on "found drift" — the
//     workflow needs to continue so it can open the alert issue.
//   * Hard errors (auth, query failure): exit non-zero so the workflow run
//     itself is marked failed and we get a "check is broken" signal.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_THRESHOLD = 0;
const WINDOW_DAYS = 2;

// The query — collapsed onto a single string for the Management API.
//
// Starts from the distinct (user_id, card_type, subject_key) tuples seen
// in grade_log over the window, normalises the evolution-stream card_types
// to the card_reviews vocabulary (#970), then LEFT JOINs to card_reviews
// on the full identity tuple. A NULL right-hand side means no card_reviews
// row exists for a card the user demonstrably graded — the #584 signature.
// The join deliberately does NOT filter card_reviews by `first_seen`:
// mature cards reviewed daily are normal and must not be counted (#1047).
const DIVERGENCE_QUERY = `
WITH gl_distinct AS (
  SELECT DISTINCT
    user_id,
    CASE card_type
      WHEN 'evolution' THEN 'evolution-edge'
      WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
      ELSE card_type
    END AS card_type,
    subject_key
  FROM grade_log
  WHERE entry_date >= (CURRENT_DATE - INTERVAL '${WINDOW_DAYS} days')::date
)
SELECT
  g.user_id::text AS user_id,
  COUNT(*)::int AS missing_subjects
FROM gl_distinct g
LEFT JOIN card_reviews cr
  ON cr.user_id = g.user_id
 AND cr.card_type = g.card_type
 AND cr.subject_key = g.subject_key
WHERE cr.user_id IS NULL
GROUP BY g.user_id
HAVING COUNT(*) > 0
ORDER BY missing_subjects DESC;
`.trim();

async function runQuery(projectRef, token, query) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(
      `Supabase Management API responded ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  const body = await res.json();
  // The Management API returns either an array or { result: [...] }.
  return Array.isArray(body) ? body : (body.result ?? []);
}

function maskUserId(id) {
  return typeof id === "string" && id.length >= 8 ? id.slice(0, 8) : "????????";
}

function formatMarkdownReport(rows, threshold) {
  const lines = [];
  lines.push("## grade_log vs card_reviews divergence detected");
  lines.push("");
  lines.push(
    `**${rows.length} user(s)** graded cards in the last ${WINDOW_DAYS * 24}h that have **no matching \`card_reviews\` row at all**.`,
  );
  lines.push("");
  lines.push("This is the same failure shape as #584 — clients grading cards");
  lines.push("but not producing the corresponding `card_reviews` rows, so the");
  lines.push("user's sync state is silently drifting. Investigate immediately.");
  lines.push("");
  lines.push("### Affected users");
  lines.push("");
  lines.push("| user_id (prefix) | grade_log subjects missing a card_reviews row |");
  lines.push("|---|---:|");
  for (const row of rows) {
    lines.push(`| \`${maskUserId(row.user_id)}\` | **${row.missing_subjects}** |`);
  }
  lines.push("");
  lines.push("### What the metric measures");
  lines.push("");
  lines.push("`grade_log` records one row per grade event (every tap, including");
  lines.push("learning-step replays). `card_reviews` records one row per");
  lines.push("`(user_id, card_type, subject_key)` tuple — one row per *card*,");
  lines.push("not per grade. A card's `card_reviews` row, once written, exists");
  lines.push("permanently; sync upserts it and never deletes it.");
  lines.push("");
  lines.push("The query below takes the distinct `(card_type, subject_key)`");
  lines.push("subjects a user graded inside the window and LEFT JOINs them to");
  lines.push("`card_reviews` on the full identity tuple, **regardless of");
  lines.push("`first_seen`**. A subject with no matching `card_reviews` row");
  lines.push("means the card_reviews write never landed for a card the user");
  lines.push("demonstrably graded — the #584 break.");
  lines.push("");
  lines.push("The grade_log `card_type` is first normalised to the");
  lines.push("`card_reviews` vocabulary (`evolution` → `evolution-edge`,");
  lines.push("`reverse-evolution` → `reverse-evolution-edge`) so");
  lines.push("evolution-stream cards are not falsely counted as missing");
  lines.push("(#970).");
  lines.push("");
  lines.push("Mature cards reviewed daily do **not** count: their");
  lines.push("`card_reviews` row exists (from when they were first learnt),");
  lines.push("so the join matches. The earlier metric compared against");
  lines.push("`card_reviews.first_seen` in the window and so counted every");
  lines.push("mature-card review as divergence — a benign false positive that");
  lines.push("#1047 removed.");
  lines.push("");
  lines.push("### Query");
  lines.push("");
  lines.push("```sql");
  lines.push(DIVERGENCE_QUERY);
  lines.push("```");
  lines.push("");
  lines.push("### Threshold");
  lines.push("");
  lines.push(`Current threshold: \`> ${threshold}\` missing subjects. With the`);
  lines.push("corrected existence metric every missing subject is a real #584");
  lines.push("signal, so the default is `0` — alert on any non-zero count. The");
  lines.push("`DIVERGENCE_THRESHOLD` env var on the");
  lines.push("`monitor-grade-log-divergence` workflow can temporarily mute a");
  lines.push("known-noisy run, but it should not normally be set above `0`.");
  lines.push("");
  lines.push("### Next steps");
  lines.push("");
  lines.push("1. Pull the affected user_ids from the workflow logs (full UUIDs are not logged here for privacy).");
  lines.push("2. Inspect their `card_reviews` and `grade_log` directly via the Supabase dashboard.");
  lines.push("3. If sync truly is broken, ship a fix on the same beat as #584 (`docs/sync.md`).");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const thresholdRaw = process.env.DIVERGENCE_THRESHOLD;
  const threshold = thresholdRaw ? Number.parseInt(thresholdRaw, 10) : DEFAULT_THRESHOLD;

  if (!token) {
    console.error("SUPABASE_ACCESS_TOKEN is not set.");
    process.exit(2);
  }
  if (!projectRef) {
    console.error("SUPABASE_PROJECT_REF is not set.");
    process.exit(2);
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    console.error(`Invalid DIVERGENCE_THRESHOLD: ${thresholdRaw}`);
    process.exit(2);
  }

  const rows = await runQuery(projectRef, token, DIVERGENCE_QUERY);

  // The query already filters to rows with at least one missing subject
  // (HAVING COUNT(*) > 0). The threshold filter is an additional escape
  // hatch: with the default threshold 0 it keeps every returned row.
  const flagged = rows.filter((r) => Number(r.missing_subjects) > threshold);

  // Always emit a one-line summary to stderr so the workflow log shows
  // what we saw, regardless of whether we're alerting.
  console.error(
    `[divergence-check] ${rows.length} user(s) graded a subject with no card_reviews row over the last ${WINDOW_DAYS * 24}h; ${flagged.length} above threshold > ${threshold}.`,
  );

  if (flagged.length === 0) {
    console.log("OK");
    return;
  }

  // Write the markdown body to disk so the workflow can `--body-file` it.
  // Fall back to a freshly-created, unpredictably-named temp directory rather
  // than a hardcoded path in the world-writable /tmp — a fixed name there is a
  // symlink-clobber target (CodeQL js/insecure-temporary-file). mkdtempSync
  // creates the dir mode 0700 with a random suffix.
  const bodyPath =
    process.env.DIVERGENCE_BODY_PATH ??
    join(mkdtempSync(join(tmpdir(), "divergence-")), "body.md");
  writeFileSync(bodyPath, formatMarkdownReport(flagged, threshold), "utf8");

  // Log the masked summary to stdout — the workflow grep / wc -l doesn't
  // rely on this, but the JSON shape is useful for manual inspection.
  console.log(
    JSON.stringify({
      threshold,
      window_hours: WINDOW_DAYS * 24,
      user_count: flagged.length,
      body_path: bodyPath,
      users: flagged.map((r) => ({
        user_id_prefix: maskUserId(r.user_id),
        missing_subjects: Number(r.missing_subjects),
      })),
    }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
