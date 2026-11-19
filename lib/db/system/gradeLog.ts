/**
 * reconcile_grade_log_orphans (Postgres migration 032, #1360) in SQLite: the
 * weekly safety net that finds subjects whose grade_log shows a graduation
 * (a grade of 4 or more in the last four days) but which have no card_reviews
 * row, and heals up to 50 of them with a conservative placeholder row.
 *
 * Same rules as 032: card types normalised ('evolution' -> 'evolution-edge',
 * 'reverse-evolution' -> 'reverse-evolution-edge'); first_seen is the earliest
 * entry, last_review the latest graduating entry, reps the graduating entries,
 * lapses the grade-1 entries after the first graduation; the placeholder has
 * stability 1, difficulty 5, scheduled_days 1, state 'review' and is due
 * today; ON CONFLICT DO NOTHING, so an existing row is never touched.
 * CURRENT_DATE was the database's UTC date; `today` is the UTC date here.
 *
 * Only importable from the cron, push-send, Discord and feedback routes
 * (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { all, run } from "./query";

/** Most placeholder rows one run may insert (032's volume cap). */
export const RECONCILE_LIMIT = 50;

// ?1 is today's UTC date ('YYYY-MM-DD'), ?2 the limit.
const ORPHANS_CTE = `
  WITH normalised AS (
    SELECT user_id,
           CASE card_type
             WHEN 'evolution' THEN 'evolution-edge'
             WHEN 'reverse-evolution' THEN 'reverse-evolution-edge'
             ELSE card_type
           END AS card_type,
           subject_key, locale, grade, entry_date
      FROM grade_log
     WHERE entry_date >= date(?1, '-4 days')
  ),
  candidates AS (
    SELECT n.user_id, n.card_type, n.subject_key, n.locale,
           min(n.entry_date) AS first_seen,
           max(n.entry_date) FILTER (WHERE n.grade >= 4) AS last_review,
           count(*) FILTER (WHERE n.grade >= 4) AS reps,
           (SELECT count(*) FROM normalised n2
             WHERE n2.user_id = n.user_id AND n2.card_type = n.card_type
               AND n2.subject_key = n.subject_key AND n2.locale = n.locale
               AND n2.grade = 1
               AND n2.entry_date > (
                 SELECT min(n3.entry_date) FROM normalised n3
                  WHERE n3.user_id = n.user_id AND n3.card_type = n.card_type
                    AND n3.subject_key = n.subject_key AND n3.locale = n.locale
                    AND n3.grade >= 4)) AS lapses
      FROM normalised n
     GROUP BY n.user_id, n.card_type, n.subject_key, n.locale
    HAVING max(n.grade) >= 4
  ),
  orphans AS (
    SELECT c.*
      FROM candidates c
      LEFT JOIN card_reviews cr
        ON cr.user_id = c.user_id AND cr.card_type = c.card_type
       AND cr.subject_key = c.subject_key AND cr.locale = c.locale
     WHERE cr.user_id IS NULL
     ORDER BY c.user_id, c.card_type, c.subject_key, c.locale
     LIMIT ?2
  )`;

export type ReconcileResult = {
  dryRun: boolean;
  /** Orphans found (at most RECONCILE_LIMIT). */
  orphans: number;
  /** Placeholder rows inserted (0 on a dry run). */
  inserted: number;
};

/**
 * Finds the orphans and, unless `dryRun` (the default, as in 032 and its
 * pg_cron job), inserts their placeholder rows.
 */
export async function reconcileGradeLogOrphans(
  db: D1DatabaseLike,
  { dryRun = true, now = new Date() }: { dryRun?: boolean; now?: Date } = {},
): Promise<ReconcileResult> {
  const today = now.toISOString().slice(0, 10);
  const [{ n }] = await all<{ n: number }>(
    db,
    `${ORPHANS_CTE} SELECT count(*) AS n FROM orphans`,
    today,
    RECONCILE_LIMIT,
  );
  if (dryRun) return { dryRun, orphans: n, inserted: 0 };

  const inserted = await run(
    db,
    `${ORPHANS_CTE}
     INSERT INTO card_reviews (
       user_id, card_type, subject_key, locale, stability, difficulty, elapsed_days,
       scheduled_days, reps, lapses, fsrs_state, due_date, last_review, first_seen,
       seen_in_pasture, hidden_since
     )
     SELECT o.user_id, o.card_type, o.subject_key, o.locale, 1.0, 5.0, 0,
            1, o.reps, o.lapses, 'review', ?1, o.last_review, o.first_seen,
            0, NULL
       FROM orphans o
      WHERE true
     ON CONFLICT (user_id, card_type, subject_key, locale) DO NOTHING`,
    today,
    RECONCILE_LIMIT,
  );
  return { dryRun, orphans: n, inserted };
}
