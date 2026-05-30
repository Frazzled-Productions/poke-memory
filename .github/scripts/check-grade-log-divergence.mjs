#!/usr/bin/env node
//
// Monitor: grade_log vs card_reviews divergence (closes #607, #1047, #1221, #1357)
//
// Why this exists
// ---------------
// The #584 incident — signed-in users grading cards without producing
// card_reviews rows — went unnoticed for ~24 hours because the only signal
// was a client-side `console.warn`. This script catches the same class of
// failure from the data side, splitting the question into three
// independent shapes so each can alert on its own.
//
// What the metric measures (#1047, refined in #1221)
// --------------------------------------------------
// `grade_log` records one row per grade event (every Again/Hard/Good/Easy
// tap, including learning-step replays). `card_reviews` records one row
// per (user_id, card_type, subject_key) tuple — i.e. one row per *card*,
// not per grade.
//
// There are three distinct failure shapes:
//
//   Option A — "row never written"
//     A subject was graded but has NO matching card_reviews row at all.
//     This is the original #584 signature: the per-grade upsert never
//     landed for a card the user demonstrably graded.
//
//   Option B — "row stuck stale"
//     A card_reviews row exists for the subject, but it looks like the
//     scheduler never actually processed grades against it
//     (`last_review IS NULL` or `reps = 0`) despite the same subject
//     receiving ≥3 grade_log entries inside the persistence window
//     (between 2 and 4 days ago, see "Re-learning false positives on
//     Option B" below). This catches the case Option A misses: the row
//     was written once (e.g. during the initial pull / merge) but every
//     subsequent per-grade update was silently dropped.
//
//   Option C — "graduated orphan, no grace" (#1357)
//     A subject whose grade_log shows a graduating grade
//     (MAX(grade) >= 4) has NO matching card_reviews row at all,
//     REGARDLESS of the 2-day grace Option A applies. Option A's
//     persistence window excludes orphans whose grades are <2 days old
//     even when they have already graduated; the #1344 assessment found
//     15 of 24 orphaned subjects slipped through exactly this gap. A
//     graduated card must sync immediately, so a graduated orphan at any
//     age is a real signal. This arm is intentionally noisier than
//     Option A (MAX(grade) >= 4 also matches a Good at an intermediate
//     step) — see the OPTION_C_QUERY comment for the trade-off. Option A
//     is left untouched; Option C is purely additive.
//
// In-step false positives (#1221)
// -------------------------------
// Cards still inside FSRS learning steps intentionally have grade_log
// entries but no card_reviews row, because `isSyncSafe()` in
// `lib/sync/cloud.ts` blocks the upsert until graduation. The original
// "any subject graded in the last 48h with no card_reviews row" query
// fired alerts for brand-new users on every first session (alerts #1213,
// #1224 were both confirmed-benign instances of this).
//
// The fix is a persistence window on Option A: only flag subjects whose
// most-recent grade_log entry is at least 2 days old. A learning-step
// run normally finishes (graduates the card, which writes the
// card_reviews row) inside a single session, and at the outer limit
// inside a day or two. By looking exclusively at subjects whose latest
// grade is between 2 and 4 days ago, we give in-step cards a 2-day grace
// period to graduate before we count them as missing. Real #584 breaks
// reappear in the same window the next day and the day after, so the
// delay does not hide them — it just removes the noise from the leading
// edge.
//
// Stuck-in-steps false positives on Option A (#1253)
// --------------------------------------------------
// The 2-day persistence window above assumes "a normal learning-step
// run graduates within a session or two". The happy path obeys that
// assumption, but a user who repeatedly grades the same card Again or
// Hard without ever hitting Good-on-last-step or Easy can sit in
// learning steps indefinitely. The scheduler design allows this on
// purpose: `lib/srs/scheduler.ts` cases A1 (Again) and B (Hard) keep
// `lastReview = null` for as long as the user keeps failing, which
// keeps `isSyncSafe()` returning false and suppresses the per-grade
// upsert. Meanwhile `grade_log` writes every tap (no in-step gate), so
// the subject accumulates grade_log entries with no card_reviews row
// across multiple days, which the 2-day-grace query would then flag.
// Alert #1243 was a confirmed instance of this shape for a user who
// had previously been flagged twice under the pre-grace monitor
// (#1213, #1224).
//
// We extend Option A's CTE with a grade-distribution check: only count
// a subject as missing if at least one of its grade_log entries inside
// the window is Good (4) or Easy (5). If every entry is Again (1) or
// Hard (2), the card is plausibly still in learning steps no matter
// how old the latest tap is, so we exclude it. The moment the user
// grades Good or Easy the card graduates locally, `isSyncSafe()`
// returns true, and a real #584 break would then become visible on
// the next qualifying tick. Future maintainers: do not re-tighten
// this query by dropping the `MAX(grade) >= 4` clause; the
// false-positive class it suppresses is structural, not transient.
//
// Re-learning false positives on Option B (#1229)
// -----------------------------------------------
// Option B also needs a 2-day grace, for a subtler reason than Option A.
// The pull-normalisation branch in `lib/sync/cloud.ts::applyCloudRow`
// resets a card to fresh state (`reps = 0`, `lastReview = null`,
// `firstSeen = null`) whenever a cloud row arrives with the invariant-
// violating shape `first_seen != null && last_review == null`. After the
// reset the local card is genuinely "new" again, so a subsequent grade
// pushes it back into learning steps (`firstSeen` set, `lastReview`
// still null) and `isSyncSafe()` correctly blocks the per-grade upsert
// until graduation. Meanwhile the cloud `card_reviews` row remains in
// its pre-reset stuck shape (`reps = 0` or `last_review IS NULL`) and
// the user keeps tapping Again/Hard/Good, producing grade_log entries.
// Without a grace period, Option B would fire for this user on day one
// of re-learning even though nothing is broken — the row will be
// rewritten the moment the card graduates.
//
// We apply the same 2-day persistence window to Option B's CTE as Option
// A has on its CTE: a stuck row whose latest grade_log entry is still
// ≥2 days old is no longer a re-learning session in progress, it is a
// genuine stuck row. Real "row stuck stale" breaks reappear in the same
// window the next day and the day after, so the delay does not hide
// them — it just removes the leading-edge noise.
//
// Option A detection floor (#1230)
// --------------------------------
// Option A's CTE filters on `entry_date >= CURRENT_DATE - 4 days` (i.e.
// OPTION_A_LOWER_BOUND_DAYS_AGO). This is a hard look-back floor:
// subjects whose most-recent grade is older than 4 days ago do not enter
// the CTE at all and are therefore invisible to the alert. An
// infrequently-reviewed card that hit the #584 break and was then left
// alone for a week would not be caught here.
//
// We accept the floor deliberately. The narrow window keeps the query
// cheap and the false-positive surface small, and the operator who lands
// on a "we missed a stale-card break for two weeks" incident can widen
// OPTION_A_LOWER_BOUND_DAYS_AGO at that point. If we ever need broader
// coverage without paying the per-tick cost, the right shape is a
// periodic deeper sweep (e.g. weekly) using the same Option A logic
// with a wider lower bound, not a permanently widened floor here.
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
// pass through unchanged. Options A, B, and C all apply this
// normalisation so they share a single join vocabulary.
//
// Required env vars
// -----------------
//   SUPABASE_ACCESS_TOKEN — Management API personal access token (same
//     secret already used by refresh-user-count.yml and migration-check).
//   SUPABASE_PROJECT_REF  — project ref slug.
//   DIVERGENCE_THRESHOLD  — optional, integer, default 0. Applied to all
//     three queries independently: a query whose row count exceeds the threshold
//     contributes to the alert. With the corrected metrics every flagged
//     subject is a real signal, so the default is 0. The env var remains
//     an escape hatch for temporarily muting a known-noisy run, but it
//     should not normally be set above 0.
//
// Output contract
// ---------------
//   * If neither query produces rows: writes "OK" to stdout, exit 0.
//   * If either query produces rows: writes a JSON object to stdout with
//     metadata for both queries, writes a Markdown body to disk for the
//     workflow to pick up via `--body-file`, and exit 0. We never exit
//     non-zero on "found drift" — the workflow needs to continue so it can
//     open the alert issue.
//   * Hard errors (auth, query failure): exit non-zero so the workflow run
//     itself is marked failed and we get a "check is broken" signal.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_THRESHOLD = 0;

// Option A persistence window (#1221). We look at grade_log entries
// whose entry_date sits between LOWER_BOUND_DAYS_AGO and
// UPPER_BOUND_DAYS_AGO (inclusive). Examples for the defaults below:
//
//   today              = 2026-05-24
//   upper bound (≤)    = 2026-05-22 (2 days ago, inclusive)
//   lower bound (≥)    = 2026-05-20 (4 days ago, inclusive)
//
// So a subject whose newest grade is on 2026-05-22 still has 2 full
// days of grace to graduate before counting as missing. The width of
// the window (2 days) keeps the look-back small enough that genuine
// breaks light up within 48h of the script's first qualifying tick,
// while the offset (≥2 days) drops the in-step noise that previously
// produced #1213 / #1224.
const OPTION_A_UPPER_BOUND_DAYS_AGO = 2;
const OPTION_A_LOWER_BOUND_DAYS_AGO = 4;

// Option B "recent activity" window. ≥3 grades inside the look-back is
// a strong signal the user is actively reviewing the card; if the
// card_reviews row is still stuck at reps=0 / last_review IS NULL after
// that many grades, the per-grade upsert is broken.
//
// The window is offset by OPTION_B_UPPER_BOUND_DAYS_AGO for the same
// re-learning false-positive reason described in the header (#1229):
// the pull-normalisation reset path produces a card_reviews row with
// reps=0 / last_review=null and accumulating grade_log entries while
// the card is in learning steps, which would otherwise match Option B
// during the leading edge of a re-learning session. We give the row a
// 2-day grace to either graduate (which rewrites it) or persist as
// genuinely stuck (which is the real signal).
const OPTION_B_UPPER_BOUND_DAYS_AGO = 2;
const OPTION_B_LOWER_BOUND_DAYS_AGO = 4;
const OPTION_B_MIN_GRADES = 3;

// Option C look-back floor (#1357). Unlike Option A, Option C has NO
// upper-bound recency grace — that is the whole point of the arm. The
// only reason to bound the look-back at all is query cost, so we reuse
// Option A's lower-bound floor as the single window edge.
const OPTION_C_LOWER_BOUND_DAYS_AGO = OPTION_A_LOWER_BOUND_DAYS_AGO;

// Option A query — "row never written".
//
// Starts from the distinct (user_id, card_type, subject_key) tuples seen
// in grade_log inside the persistence window, normalises the
// evolution-stream card_types to the card_reviews vocabulary (#970),
// then LEFT JOINs to card_reviews on the full identity tuple. A NULL
// right-hand side means no card_reviews row exists for a card the user
// demonstrably graded at least OPTION_A_UPPER_BOUND_DAYS_AGO days ago —
// the #584 signature, with in-step cards filtered out by the offset.
//
// The MAX(entry_date) on the grade_log side determines the subject's
// freshness: we want subjects whose LATEST grade falls inside the
// window. A subject graded today and again 3 days ago should not flag,
// because the recent grade means the card is still in-step.
//
// The `MAX(grade) >= 4` clause is the stuck-in-steps grace from #1253.
// A subject whose every grade_log entry is Again (1) or Hard (2) has
// not yet hit a graduation-eligible rating, so the scheduler keeps
// `lastReview = null` and `isSyncSafe()` keeps blocking the per-grade
// upsert by design. Cards in that state legitimately accumulate
// grade_log entries with no card_reviews row over many days. We
// exclude them here so they do not show up as #584 false positives.
// Grade ratings: 1=Again, 2=Hard, 4=Good, 5=Easy (per
// `lib/srs/scheduler.ts`).
const OPTION_A_QUERY = `
WITH gl_distinct AS (
  SELECT
    user_id,
    CASE card_type
      WHEN 'evolution' THEN 'evolution-edge'
      WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
      ELSE card_type
    END AS card_type,
    subject_key,
    MAX(entry_date) AS last_entry_date,
    MAX(grade) AS max_grade
  FROM grade_log
  WHERE entry_date >= (CURRENT_DATE - INTERVAL '${OPTION_A_LOWER_BOUND_DAYS_AGO} days')::date
  GROUP BY user_id, card_type, subject_key
  HAVING MAX(entry_date) <= (CURRENT_DATE - INTERVAL '${OPTION_A_UPPER_BOUND_DAYS_AGO} days')::date
     AND MAX(grade) >= 4
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

// Option B query — "row stuck stale".
//
// Find subjects with ≥OPTION_B_MIN_GRADES grade_log entries inside the
// persistence window (entry_date between LOWER_BOUND and UPPER_BOUND
// days ago, both inclusive), normalised to the card_reviews vocabulary,
// then JOIN (not LEFT JOIN) to card_reviews. The row must exist; the
// failure shape is "exists but stuck". A stuck row has either
// `last_review IS NULL` (never been processed by the scheduler at all)
// or `reps = 0` (scheduler never registered a successful review). Both
// are inconsistent with multiple recent grades.
//
// The HAVING `MAX(entry_date) <= ... UPPER_BOUND days ago` clause gives
// re-learning sessions a 2-day grace to graduate before counting them
// as stuck (#1229). See the header rationale for why this matches
// Option A's offset.
//
// Aggregating to one row per user keeps the alert compact and matches
// the Option A shape, so the markdown can render them in parallel.
const OPTION_B_QUERY = `
WITH recent_grades AS (
  SELECT
    user_id,
    CASE card_type
      WHEN 'evolution' THEN 'evolution-edge'
      WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
      ELSE card_type
    END AS card_type,
    subject_key,
    COUNT(*) AS grade_count
  FROM grade_log
  WHERE entry_date >= (CURRENT_DATE - INTERVAL '${OPTION_B_LOWER_BOUND_DAYS_AGO} days')::date
  GROUP BY user_id, card_type, subject_key
  HAVING COUNT(*) >= ${OPTION_B_MIN_GRADES}
     AND MAX(entry_date) <= (CURRENT_DATE - INTERVAL '${OPTION_B_UPPER_BOUND_DAYS_AGO} days')::date
)
SELECT
  r.user_id::text AS user_id,
  COUNT(*)::int AS stuck_subjects
FROM recent_grades r
JOIN card_reviews cr
  ON cr.user_id = r.user_id
 AND cr.card_type = r.card_type
 AND cr.subject_key = r.subject_key
WHERE cr.last_review IS NULL OR cr.reps = 0
GROUP BY r.user_id
HAVING COUNT(*) > 0
ORDER BY stuck_subjects DESC;
`.trim();

// Option C query — "graduated orphan, regardless of grace" (#1357).
//
// This arm exists because Option A's 2-day persistence window
// (OPTION_A_UPPER_BOUND_DAYS_AGO) has a blind spot: a card that has
// already GRADUATED but whose grades are <2 days old is excluded by the
// `MAX(entry_date) <= CURRENT_DATE - 2` grace filter. The #1344
// assessment found 15 of 24 orphaned subjects (user 6fbfd530) were never
// flagged for exactly this reason. A graduated card must sync
// immediately (`isSyncSafe()` returns true the moment it leaves learning
// steps), so a graduated subject with no card_reviews row is a real
// signal at ANY age — the in-step grace does not apply to it.
//
// The query is Option A's CTE with the upper-bound recency grace
// REMOVED. We keep only the lower-bound look-back floor
// (OPTION_C_LOWER_BOUND_DAYS_AGO, reusing Option A's floor) to bound
// query cost — see the #1230 floor rationale in the header. The
// evolution-stream card_type normalisation (#970) is copied verbatim
// from Options A/B; dropping it would falsely flag every evolution-stream
// card.
//
// Trade-off — Option C is intentionally noisier than Option A.
// "Graduated" is approximated from grade_log alone as `MAX(grade) >= 4`,
// the same proxy Option A already uses. But because Option C drops the
// recency offset, this proxy is looser here: a single Good (4) at an
// intermediate learning step also satisfies `MAX(grade) >= 4` even though
// that card has NOT actually graduated yet, so an in-step card that has
// been graded Good once but not yet finished its steps can show up in
// this arm during the leading edge. We accept that false-positive surface
// deliberately: the cost of a benign Option C hit is one investigation,
// whereas the cost of the blind spot it closes is a silently un-synced
// graduated card (the #1344 shape). Do NOT add an upper-bound recency
// grace to this arm to quieten it — that re-creates the exact blind spot
// Option A already owns and this arm exists to cover.
//
// Option A is left untouched: its 2-day grace is deliberate and removing
// it re-introduces the in-step noise that produced #1213 / #1224. Option
// C is purely additive — a third arm alongside A and B, never a
// replacement for A.
//
// Grade ratings: 1=Again, 2=Hard, 4=Good, 5=Easy (per
// `lib/srs/scheduler.ts`).
const OPTION_C_QUERY = `
WITH gl_graduated AS (
  SELECT
    user_id,
    CASE card_type
      WHEN 'evolution' THEN 'evolution-edge'
      WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
      ELSE card_type
    END AS card_type,
    subject_key,
    MAX(entry_date) AS last_entry_date,
    MAX(grade)      AS max_grade
  FROM grade_log
  WHERE entry_date >= (CURRENT_DATE - INTERVAL '${OPTION_C_LOWER_BOUND_DAYS_AGO} days')::date
  GROUP BY user_id, card_type, subject_key
  HAVING MAX(grade) >= 4
)
SELECT
  g.user_id::text AS user_id,
  COUNT(*)::int AS graduated_orphan_subjects
FROM gl_graduated g
LEFT JOIN card_reviews cr
  ON cr.user_id = g.user_id
 AND cr.card_type = g.card_type
 AND cr.subject_key = g.subject_key
WHERE cr.user_id IS NULL
GROUP BY g.user_id
HAVING COUNT(*) > 0
ORDER BY graduated_orphan_subjects DESC;
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

// Markdown sections. We keep Option A and Option B in separate
// formatters so the assembled body can include only the sections that
// fired. The top-level `formatMarkdownReport` glues them together with
// a shared header.
function formatOptionASection(rows) {
  const lines = [];
  lines.push("### Option A — `card_reviews` row never written");
  lines.push("");
  lines.push(
    `**${rows.length} user(s)** graded a subject between ${OPTION_A_UPPER_BOUND_DAYS_AGO} and ${OPTION_A_LOWER_BOUND_DAYS_AGO} days ago that still has **no matching \`card_reviews\` row at all**.`,
  );
  lines.push("");
  lines.push("This is the same failure shape as #584 — clients grading cards");
  lines.push("but not producing the corresponding `card_reviews` rows, so the");
  lines.push("user's sync state is silently drifting. Investigate immediately.");
  lines.push("");
  lines.push("The 2-day offset is the in-step grace period introduced in #1221:");
  lines.push("cards still inside FSRS learning steps intentionally have");
  lines.push("grade_log entries but no card_reviews row (see `isSyncSafe()` in");
  lines.push("`lib/sync/cloud.ts`). A normal learning-step run graduates within");
  lines.push("a session or two, so a subject whose latest grade is ≥2 days old");
  lines.push("and still has no card_reviews row is no longer in-step — it is a");
  lines.push("genuine #584 break.");
  lines.push("");
  lines.push("| user_id (prefix) | grade_log subjects missing a card_reviews row |");
  lines.push("|---|---:|");
  for (const row of rows) {
    lines.push(`| \`${maskUserId(row.user_id)}\` | **${row.missing_subjects}** |`);
  }
  lines.push("");
  lines.push("```sql");
  lines.push(OPTION_A_QUERY);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function formatOptionBSection(rows) {
  const lines = [];
  lines.push("### Option B — `card_reviews` row exists but is stuck");
  lines.push("");
  lines.push(
    `**${rows.length} user(s)** have a \`card_reviews\` row whose \`last_review IS NULL\` or \`reps = 0\` despite the same subject receiving **≥${OPTION_B_MIN_GRADES} grade_log entries between ${OPTION_B_UPPER_BOUND_DAYS_AGO} and ${OPTION_B_LOWER_BOUND_DAYS_AGO} days ago**.`,
  );
  lines.push("");
  lines.push("This is the failure shape Option A cannot see: the per-grade");
  lines.push("upsert wrote the row once (e.g. during the initial pull / merge)");
  lines.push("but every subsequent update was silently dropped. The scheduler");
  lines.push("never advanced the row, so the user's review history is");
  lines.push("effectively frozen even though the client thinks it is syncing.");
  lines.push("");
  lines.push("The 2-day offset is the re-learning grace period introduced in");
  lines.push("#1229: the pull-normalisation reset path in `lib/sync/cloud.ts`");
  lines.push("can leave a `card_reviews` row at `reps = 0` while the user is");
  lines.push("actively re-learning the card, and `isSyncSafe()` blocks the");
  lines.push("per-grade upsert until graduation. A subject whose latest grade");
  lines.push("is ≥2 days old and the row is still stuck is no longer mid");
  lines.push("re-learning — it is a genuine stuck row.");
  lines.push("");
  lines.push("| user_id (prefix) | stuck subjects |");
  lines.push("|---|---:|");
  for (const row of rows) {
    lines.push(`| \`${maskUserId(row.user_id)}\` | **${row.stuck_subjects}** |`);
  }
  lines.push("");
  lines.push("```sql");
  lines.push(OPTION_B_QUERY);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function formatOptionCSection(rows) {
  const lines = [];
  lines.push("### Option C — graduated subject with no `card_reviews` row (no grace)");
  lines.push("");
  lines.push(
    `**${rows.length} user(s)** have a subject whose grade_log shows a graduating grade (\`MAX(grade) >= 4\`) within the last ${OPTION_C_LOWER_BOUND_DAYS_AGO} days but **no matching \`card_reviews\` row at all**, regardless of how recent the grade is.`,
  );
  lines.push("");
  lines.push("This is the blind spot Option A cannot see (#1357, from the #1344");
  lines.push("assessment): Option A's 2-day in-step grace excludes orphans whose");
  lines.push("grades are <2 days old, even when they have already graduated. A");
  lines.push("graduated card must sync immediately (`isSyncSafe()` returns true on");
  lines.push("graduation), so a graduated orphan is a real #584-shape signal at any");
  lines.push("age — the in-step grace deliberately does not apply to it.");
  lines.push("");
  lines.push("Trade-off: this arm is noisier than Option A by design. `MAX(grade)");
  lines.push(">= 4` is a graduation proxy from grade_log alone, so a single Good at");
  lines.push("an intermediate learning step can also match. A benign hit here is");
  lines.push("one investigation; the blind spot it closes is a silently un-synced");
  lines.push("graduated card. Option A is left untouched — its grace is deliberate.");
  lines.push("");
  lines.push("| user_id (prefix) | graduated subjects missing a card_reviews row |");
  lines.push("|---|---:|");
  for (const row of rows) {
    lines.push(`| \`${maskUserId(row.user_id)}\` | **${row.graduated_orphan_subjects}** |`);
  }
  lines.push("");
  lines.push("```sql");
  lines.push(OPTION_C_QUERY);
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

function formatMarkdownReport(flaggedA, flaggedB, flaggedC, threshold) {
  const lines = [];
  lines.push("## grade_log vs card_reviews divergence detected");
  lines.push("");
  const firedParts = [];
  if (flaggedA.length > 0) firedParts.push(`**Option A**: ${flaggedA.length} user(s)`);
  if (flaggedB.length > 0) firedParts.push(`**Option B**: ${flaggedB.length} user(s)`);
  if (flaggedC.length > 0) firedParts.push(`**Option C**: ${flaggedC.length} user(s)`);
  lines.push(`Fired: ${firedParts.join(" • ")}.`);
  lines.push("");
  lines.push("This monitor splits the divergence question into three independent");
  lines.push("shapes (Options A/B introduced in #1221, Option C in #1357). Any");
  lines.push("firing is a real signal; several firing for the same user is the");
  lines.push("loudest possible #584 alert.");
  lines.push("");
  if (flaggedA.length > 0) {
    lines.push(formatOptionASection(flaggedA));
  }
  if (flaggedB.length > 0) {
    lines.push(formatOptionBSection(flaggedB));
  }
  if (flaggedC.length > 0) {
    lines.push(formatOptionCSection(flaggedC));
  }
  lines.push("### What the metric measures");
  lines.push("");
  lines.push("`grade_log` records one row per grade event (every tap, including");
  lines.push("learning-step replays). `card_reviews` records one row per");
  lines.push("`(user_id, card_type, subject_key)` tuple — one row per *card*,");
  lines.push("not per grade. A card's `card_reviews` row, once written, exists");
  lines.push("permanently; sync upserts it and never deletes it.");
  lines.push("");
  lines.push("All three queries first normalise the grade_log `card_type` to the");
  lines.push("`card_reviews` vocabulary (`evolution` → `evolution-edge`,");
  lines.push("`reverse-evolution` → `reverse-evolution-edge`) so evolution-stream");
  lines.push("cards are not falsely counted (#970).");
  lines.push("");
  lines.push("### Threshold");
  lines.push("");
  lines.push(`Current threshold: \`> ${threshold}\` subjects (applied to each`);
  lines.push("query independently). With the corrected metrics every flagged");
  lines.push("subject is a real signal, so the default is `0` — alert on any");
  lines.push("non-zero count. The `DIVERGENCE_THRESHOLD` env var on the");
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

  // Run each query independently so a failure in one does not mask
  // the others. We do NOT Promise.all here: a fault in any query
  // should bubble up as a workflow failure (the "check is broken"
  // signal), and serial execution makes the failing query obvious in
  // the workflow log.
  const rowsA = await runQuery(projectRef, token, OPTION_A_QUERY);
  const rowsB = await runQuery(projectRef, token, OPTION_B_QUERY);
  const rowsC = await runQuery(projectRef, token, OPTION_C_QUERY);

  // Per-query threshold filter. All default to "any non-zero".
  const flaggedA = rowsA.filter((r) => Number(r.missing_subjects) > threshold);
  const flaggedB = rowsB.filter((r) => Number(r.stuck_subjects) > threshold);
  const flaggedC = rowsC.filter((r) => Number(r.graduated_orphan_subjects) > threshold);

  // Always emit a one-line summary to stderr so the workflow log shows
  // what we saw, regardless of whether we're alerting.
  console.error(
    `[divergence-check] Option A: ${rowsA.length} user(s) with subjects ≥${OPTION_A_UPPER_BOUND_DAYS_AGO}d old missing a card_reviews row (${flaggedA.length} above threshold). Option B: ${rowsB.length} user(s) with stuck card_reviews rows despite ≥${OPTION_B_MIN_GRADES} grades ≥${OPTION_B_UPPER_BOUND_DAYS_AGO}d old (${flaggedB.length} above threshold). Option C: ${rowsC.length} user(s) with graduated orphans within ${OPTION_C_LOWER_BOUND_DAYS_AGO}d, no grace (${flaggedC.length} above threshold).`,
  );

  if (flaggedA.length === 0 && flaggedB.length === 0 && flaggedC.length === 0) {
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
  writeFileSync(bodyPath, formatMarkdownReport(flaggedA, flaggedB, flaggedC, threshold), "utf8");

  // Log the masked summary to stdout — the workflow grep / wc -l doesn't
  // rely on this, but the JSON shape is useful for manual inspection.
  // `user_count` is the union of users flagged by any query, so the
  // workflow's issue title reflects the total breadth of the alert.
  const flaggedUserIds = new Set([
    ...flaggedA.map((r) => r.user_id),
    ...flaggedB.map((r) => r.user_id),
    ...flaggedC.map((r) => r.user_id),
  ]);
  console.log(
    JSON.stringify(
      {
        threshold,
        option_a: {
          upper_bound_days_ago: OPTION_A_UPPER_BOUND_DAYS_AGO,
          lower_bound_days_ago: OPTION_A_LOWER_BOUND_DAYS_AGO,
          user_count: flaggedA.length,
          users: flaggedA.map((r) => ({
            user_id_prefix: maskUserId(r.user_id),
            missing_subjects: Number(r.missing_subjects),
          })),
        },
        option_b: {
          upper_bound_days_ago: OPTION_B_UPPER_BOUND_DAYS_AGO,
          lower_bound_days_ago: OPTION_B_LOWER_BOUND_DAYS_AGO,
          min_grades: OPTION_B_MIN_GRADES,
          user_count: flaggedB.length,
          users: flaggedB.map((r) => ({
            user_id_prefix: maskUserId(r.user_id),
            stuck_subjects: Number(r.stuck_subjects),
          })),
        },
        option_c: {
          lower_bound_days_ago: OPTION_C_LOWER_BOUND_DAYS_AGO,
          user_count: flaggedC.length,
          users: flaggedC.map((r) => ({
            user_id_prefix: maskUserId(r.user_id),
            graduated_orphan_subjects: Number(r.graduated_orphan_subjects),
          })),
        },
        user_count: flaggedUserIds.size,
        body_path: bodyPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
