#!/usr/bin/env node
//
// Monitor: grade_log vs card_reviews divergence (closes #607)
//
// Why this exists
// ---------------
// The #584 incident — signed-in users grading cards without producing
// card_reviews rows — went unnoticed for ~24 hours because the only signal
// was a client-side `console.warn`. This script catches the same class of
// failure from the data side: if a user's grade_log shows activity in the
// last 48h but their card_reviews table has materially fewer new rows over
// the same window, sync is broken for them.
//
// What "normal" looks like
// ------------------------
// `grade_log` records one row per grade event (every Again/Hard/Good/Easy
// tap, including learning-step replays). `card_reviews` records one row
// per (user_id, card_type, subject_key) tuple — i.e. one row per *card*,
// not per grade. During the learning-step phase a single card typically
// produces 1.5–3x more grade_log entries than the single row it occupies
// in card_reviews (see docs/srs.md for the learning-step ladder).
//
// BUT — the query below compares DISTINCT (card_type, subject_key) tuples
// in grade_log against COUNT(*) of card_reviews first_seen in the same
// window, so the per-card replay ratio is collapsed away. In the steady
// state these two numbers should match very closely:
//
//   distinct grade_log subjects (48h) ≈ card_reviews with first_seen (48h)
//
// A small gap is legitimate. Sources of legitimate drift:
//   * A card first_seen on day T-3 is graded again on day T-1: it
//     contributes to grade_log's 48h distinct-subject count but not to
//     card_reviews' 48h first_seen count.
//   * Clock skew at day boundaries.
//   * Pre-existing card_reviews rows that pre-date migration 010 having
//     mismatched subject_key encoding (now resolved, but defence in depth).
//
// We threshold at gap > 5 by default (overridable via DIVERGENCE_THRESHOLD).
// The #584 signature is gap == distinct_subjects (i.e. user graded N cards,
// produced zero card_reviews rows for any of them), which is what we want
// the alert to surface immediately on the next 08:00 UTC cron tick.
//
// Required env vars
// -----------------
//   SUPABASE_ACCESS_TOKEN — Management API personal access token (same
//     secret already used by refresh-user-count.yml and migration-check).
//   SUPABASE_PROJECT_REF  — project ref slug.
//   DIVERGENCE_THRESHOLD  — optional, integer, default 5.
//
// Output contract
// ---------------
//   * If no users diverge: writes "OK" to stdout, exit 0.
//   * If one or more users diverge: writes a JSON object to stdout of the
//     shape { users: [{ user_id, distinct_subjects, new_cards, gap }, ...] }
//     and exit 0. We never exit non-zero on "found drift" — the workflow
//     needs to continue so it can open the alert issue.
//   * Hard errors (auth, query failure): exit non-zero so the workflow run
//     itself is marked failed and we get a "check is broken" signal.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_THRESHOLD = 5;
const WINDOW_DAYS = 2;

// The query — collapsed onto a single string for the Management API.
// Starts from grade_log so users with grade_log activity but zero
// card_reviews rows in the window are surfaced (gap = distinct_subjects).
// This is the #584 signature we most want to catch.
//
// card_type normalisation (#970)
// ------------------------------
// grade_log and card_reviews use different card_type conventions for
// evolution-stream cards. The grade_log write path (lib/sync/gradeLog.ts)
// stores the raw app type — 'evolution' / 'reverse-evolution' — while the
// card_reviews push path runs appTypeToDbType (lib/sync/cloud.ts), which
// rewrites those to the '-edge' suffixed forms 'evolution-edge' /
// 'reverse-evolution-edge'. Counting raw grade_log card_types would make
// every evolution-stream card look "missing" from card_reviews and inflate
// the gap, producing false #584-shape alerts. The CASE below replicates
// appTypeToDbType on the grade_log side so the DISTINCT subject count is
// expressed in the same card_type vocabulary as card_reviews. All other
// card types (name / reverse / cry) are identical across both tables and
// pass through unchanged.
const DIVERGENCE_QUERY = `
WITH gl AS (
  SELECT
    user_id,
    COUNT(DISTINCT (
      CASE card_type
        WHEN 'evolution' THEN 'evolution-edge'
        WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
        ELSE card_type
      END,
      subject_key
    ))::int AS distinct_subjects
  FROM grade_log
  WHERE entry_date >= (CURRENT_DATE - INTERVAL '${WINDOW_DAYS} days')::date
  GROUP BY user_id
),
cr AS (
  SELECT user_id, COUNT(*)::int AS new_cards
  FROM card_reviews
  WHERE first_seen >= (CURRENT_DATE - INTERVAL '${WINDOW_DAYS} days')::date
  GROUP BY user_id
)
SELECT
  gl.user_id::text AS user_id,
  gl.distinct_subjects,
  COALESCE(cr.new_cards, 0) AS new_cards,
  gl.distinct_subjects - COALESCE(cr.new_cards, 0) AS gap
FROM gl
LEFT JOIN cr ON cr.user_id = gl.user_id
ORDER BY gap DESC;
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
    `**${rows.length} user(s)** showed a gap of more than \`${threshold}\` between distinct \`grade_log\` subjects and \`card_reviews\` rows over the last ${WINDOW_DAYS * 24}h window.`,
  );
  lines.push("");
  lines.push("This is the same failure shape as #584 — clients grading cards");
  lines.push("but not producing the corresponding `card_reviews` rows, so the");
  lines.push("user's sync state is silently drifting. Investigate immediately.");
  lines.push("");
  lines.push("### Affected users");
  lines.push("");
  lines.push("| user_id (prefix) | distinct grade_log subjects (48h) | card_reviews first_seen (48h) | gap |");
  lines.push("|---|---:|---:|---:|");
  for (const row of rows) {
    lines.push(
      `| \`${maskUserId(row.user_id)}\` | ${row.distinct_subjects} | ${row.new_cards} | **${row.gap}** |`,
    );
  }
  lines.push("");
  lines.push("### What \"normal\" looks like");
  lines.push("");
  lines.push("`grade_log` records one row per grade event (every tap, including");
  lines.push("learning-step replays). `card_reviews` records one row per");
  lines.push("`(user_id, card_type, subject_key)` tuple — one row per *card*,");
  lines.push("not per grade. During the learning-step phase, a single card");
  lines.push("typically produces 1.5–3x more grade_log entries than the single");
  lines.push("row it occupies in card_reviews.");
  lines.push("");
  lines.push("The query below collapses that replay ratio by counting");
  lines.push("**DISTINCT `(card_type, subject_key)` tuples** in grade_log, so");
  lines.push("the two numbers should match closely in the steady state. The");
  lines.push("grade_log `card_type` is first normalised to the `card_reviews`");
  lines.push("vocabulary (`evolution` → `evolution-edge`, `reverse-evolution`");
  lines.push("→ `reverse-evolution-edge`) so evolution-stream cards are not");
  lines.push("falsely counted as missing (#970). A");
  lines.push("small gap (≤ 5) is legitimate (cards first-seen on prior days");
  lines.push("being re-graded inside the window). A large gap — especially");
  lines.push("`gap == distinct_subjects` (zero card_reviews) — is the #584");
  lines.push("signature.");
  lines.push("");
  lines.push("### Query");
  lines.push("");
  lines.push("```sql");
  lines.push(DIVERGENCE_QUERY);
  lines.push("```");
  lines.push("");
  lines.push("### Threshold");
  lines.push("");
  lines.push(`Current threshold: \`> ${threshold}\` rows. Tune via the`);
  lines.push("`DIVERGENCE_THRESHOLD` env var on the");
  lines.push("`monitor-grade-log-divergence` workflow if it turns out to be");
  lines.push("too tight or too loose in practice.");
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

  // Defensive: keep only rows above threshold, in case the query is ever
  // changed to return below-threshold rows for debugging.
  const flagged = rows.filter((r) => Number(r.gap) > threshold);

  // Always emit a one-line summary to stderr so the workflow log shows
  // what we saw, regardless of whether we're alerting.
  console.error(
    `[divergence-check] scanned ${rows.length} active user(s) over the last ${WINDOW_DAYS * 24}h; ${flagged.length} above threshold > ${threshold}.`,
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
        distinct_subjects: Number(r.distinct_subjects),
        new_cards: Number(r.new_cards),
        gap: Number(r.gap),
      })),
    }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
