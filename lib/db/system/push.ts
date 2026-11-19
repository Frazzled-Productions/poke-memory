/**
 * Cross-user reads and writes for the Web Push cron routes (design D4):
 * ports of get_push_targets and get_push_due_cards (Postgres migration 046),
 * get_push_streak_days (047) and the dead-endpoint delete.
 *
 * Time zones: none of these queries looks at a time zone, as in Postgres. The
 * routes decide who is due this hour (lib/push/notificationHour.ts) and each
 * user's "today" (todayInTimezone) in TypeScript and pass the date in.
 *
 * Only importable from the cron, push-send, Discord and feedback routes
 * (ESLint no-restricted-imports in eslint.config.mjs).
 */
import type { D1DatabaseLike } from "../d1";
import { all, run } from "./query";

/** One row per push subscription, with the owner's settings (null when there is no settings row). */
export type PushTargetRow = {
  subscription_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  timezone: string | null;
  settings: Record<string, unknown> | null;
  push_notification_hour: number | null;
};

/** A due, non-hidden card_reviews row for one time-zone bucket. */
export type PushDueCardRow = {
  user_id: string;
  card_type: string;
  subject_key: string;
  first_seen: string | null;
  locale: string;
  due_date: string;
};

export type PushStreakDayRow = {
  user_id: string;
  review_date: string;
};

function parseSettings(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * get_push_targets (046): every push subscription LEFT JOINed to its owner's
 * user_settings row (users without one still get pushes), ordered by user and
 * subscription id.
 */
export async function getPushTargets(db: D1DatabaseLike): Promise<PushTargetRow[]> {
  const rows = await all<Omit<PushTargetRow, "settings"> & { settings: unknown }>(
    db,
    `SELECT ps.id AS subscription_id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth_secret,
            us.timezone, us.settings, us.push_notification_hour
       FROM push_subscriptions ps
       LEFT JOIN user_settings us ON us.user_id = ps.user_id
      ORDER BY ps.user_id, ps.id`,
  );
  return rows.map((row) => ({ ...row, settings: parseSettings(row.settings) }));
}

/**
 * get_push_due_cards (046): the non-hidden card_reviews rows of `userIds`
 * due on or before `today` ('YYYY-MM-DD', the bucket's local date), ordered
 * by user and due date. D1 has no PostgREST row cap, so there is no paging.
 */
export async function getPushDueCards(
  db: D1DatabaseLike,
  userIds: readonly string[],
  today: string,
): Promise<PushDueCardRow[]> {
  if (userIds.length === 0) return [];
  return all<PushDueCardRow>(
    db,
    `SELECT cr.user_id, cr.card_type, cr.subject_key, cr.first_seen, cr.locale, cr.due_date
       FROM card_reviews cr
      WHERE cr.due_date <= ?
        AND cr.user_id IN (SELECT value FROM json_each(?))
        AND cr.hidden_since IS NULL
      ORDER BY cr.user_id, cr.due_date`,
    today,
    JSON.stringify(userIds),
  );
}

/**
 * get_push_streak_days (047): every streak_days row of `userIds`, ordered by
 * user and date. The full history: the streak maths walks all of it.
 */
export async function getPushStreakDays(
  db: D1DatabaseLike,
  userIds: readonly string[],
): Promise<PushStreakDayRow[]> {
  if (userIds.length === 0) return [];
  return all<PushStreakDayRow>(
    db,
    `SELECT sd.user_id, sd.review_date
       FROM streak_days sd
      WHERE sd.user_id IN (SELECT value FROM json_each(?))
      ORDER BY sd.user_id, sd.review_date`,
    JSON.stringify(userIds),
  );
}

/**
 * Deletes the subscriptions a push service reported gone (404 or 410).
 * Returns how many rows went.
 */
export async function deleteDeadPushSubscriptions(
  db: D1DatabaseLike,
  subscriptionIds: readonly string[],
): Promise<number> {
  if (subscriptionIds.length === 0) return 0;
  return run(
    db,
    `DELETE FROM push_subscriptions WHERE id IN (SELECT value FROM json_each(?))`,
    JSON.stringify(subscriptionIds),
  );
}
