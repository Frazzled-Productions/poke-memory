/**
 * Maps a Cloudflare Cron Trigger firing to the app routes it runs (decision
 * 0018, design D2). Two triggers in wrangler.jsonc replace the six pg_cron
 * jobs; each route keeps its own constant-time bearer check on
 * CRON_SHARED_SECRET. All times are UTC.
 *
 * | Was (pg_cron)                        | Now (UTC)        | Route                              |
 * |--------------------------------------|------------------|------------------------------------|
 * | hourly daily reminders (031)         | every hour       | POST /api/push/send-daily          |
 * | hourly streak nudge (047)            | every hour       | POST /api/push/send-streak-nudge   |
 * | weekly digest, Monday 09:00 (042)    | Monday 09:00     | POST /api/discord/digest           |
 * | feedback retention, 03:00 (034)      | 03:00            | POST /api/cron/feedback-retention  |
 * | grade_log orphan reconcile (032)     | Sunday 04:00     | POST /api/cron/reconcile-grade-log |
 * | rate-limit bucket clean-up (041)     | every 30 minutes | POST /api/cron/rate-limit-cleanup  |
 * | (new) nightly backup                 | 02:00            | POST /api/cron/backup              |
 *
 * The `0 * * * *` trigger runs everything on the hour; `*\/30 * * * *` runs
 * only the clean-up (it also fires on the hour, so hourly work must not hang
 * off it or it would run twice).
 */

/** Fires at minute 0 of every hour. */
export const HOURLY_CRON = "0 * * * *";
/** Fires at minutes 0 and 30 of every hour. */
export const HALF_HOURLY_CRON = "*/30 * * * *";

export const CRON_ROUTES = {
  sendDaily: "/api/push/send-daily",
  sendStreakNudge: "/api/push/send-streak-nudge",
  discordDigest: "/api/discord/digest",
  feedbackRetention: "/api/cron/feedback-retention",
  reconcileGradeLog: "/api/cron/reconcile-grade-log",
  rateLimitCleanup: "/api/cron/rate-limit-cleanup",
  backup: "/api/cron/backup",
} as const;

const SUNDAY = 0;
const MONDAY = 1;

/**
 * The routes to POST for one firing of `cron` at `now` (the event's
 * scheduledTime). Pure: no clock, no environment. An unknown cron string maps
 * to no routes.
 */
export function cronRoutesFor(cron: string, now: Date): string[] {
  if (cron === HALF_HOURLY_CRON) return [CRON_ROUTES.rateLimitCleanup];
  if (cron !== HOURLY_CRON) return [];

  const hour = now.getUTCHours();
  const day = now.getUTCDay();
  const routes: string[] = [CRON_ROUTES.sendDaily, CRON_ROUTES.sendStreakNudge];
  if (hour === 2) routes.push(CRON_ROUTES.backup);
  if (hour === 3) routes.push(CRON_ROUTES.feedbackRetention);
  if (hour === 4 && day === SUNDAY) routes.push(CRON_ROUTES.reconcileGradeLog);
  if (hour === 9 && day === MONDAY) routes.push(CRON_ROUTES.discordDigest);
  return routes;
}
