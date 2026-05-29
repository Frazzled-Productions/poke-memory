/**
 * Pure helpers for per-user push-notification-hour selection logic (#1315).
 *
 * Extracted so they can be unit-tested without touching the network, the DB,
 * or the Node.js route runtime.
 *
 * The send-daily route fires (currently) once per day at 08:00 UTC via
 * pg_cron. When the phase-2 migration (031) flips the cron to hourly, the
 * route will fire once per hour and `shouldSendToUser` will gate each call
 * correctly using the user's local preferred hour converted to UTC.
 *
 * IMPORTANT — interim behaviour (this PR):
 * The cron is STILL daily (0 8 * * *). Users with no preference (NULL →
 * effective UTC hour 8) continue to receive their notification exactly as
 * before. Users who set a non-8-UTC-equivalent preferred hour will be
 * DORMANT until the phase-2 cron change is applied post-promotion. This is
 * safe: no user receives a duplicate notification; no existing user loses
 * their notification.
 */

/**
 * Default send hour in UTC. Used when the user has not set a preference.
 * Must match the current cron schedule (0 8 * * *) so existing users keep
 * their 08:00 UTC notification with no observable change.
 */
export const PUSH_DEFAULT_HOUR_UTC = 8;

/**
 * Convert a user's local preferred hour (0-23, in their timezone) to the
 * equivalent UTC hour at a given reference timestamp.
 *
 * Uses `Intl.DateTimeFormat` evaluated against `now` so DST transitions are
 * handled correctly — the UTC offset is derived from the actual civil wall
 * clock at `now`, not from a fixed offset. Two DST-adjacent timestamps an
 * hour apart on the same `referenceHour` in the same `timezone` may return
 * different UTC hours: that is correct behaviour.
 *
 * Returns the UTC hour (0-23) whose *start* corresponds to the local hour
 * `referenceHour` in `timezone` at `now`.
 *
 * If `timezone` is null / blank / invalid, the value is treated as already
 * in UTC (i.e. `referenceHour` is returned directly). This is the safe
 * fallback: an unknown timezone is treated as UTC rather than silently
 * converting with a wrong offset.
 *
 * Algorithm:
 *   1. Build a synthetic Date that, when formatted in `timezone`, reads
 *      `referenceHour:00`. We do this by formatting `now` in `timezone`
 *      to get the current local time, then offset `now` by
 *      `(referenceHour - currentLocalHour) hours`.
 *   2. Extract the UTC hour from that synthetic Date.
 */
export function localHourToUtcHour(
  referenceHour: number,
  timezone: string | null,
  now: Date,
): number {
  if (!timezone) return referenceHour % 24;

  let currentLocalHour: number;
  try {
    // Extract the current hour in the user's timezone using Intl.
    // hour12: false gives 0-23 — but Intl can return "24" for midnight in
    // some implementations, so we normalise with % 24.
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
    currentLocalHour = parseInt(hourStr, 10) % 24;
  } catch {
    // Invalid timezone — fall back to treating referenceHour as UTC.
    return referenceHour % 24;
  }

  // Shift `now` so that the local clock reads referenceHour:00.
  const deltaHours = referenceHour - currentLocalHour;
  const shifted = new Date(now.getTime() + deltaHours * 60 * 60 * 1000);
  return shifted.getUTCHours();
}

/**
 * Returns the current UTC hour for a given timestamp (0-23).
 * Thin wrapper kept here so the route and tests can import from one place.
 */
export function currentUtcHour(now: Date): number {
  return now.getUTCHours();
}

/**
 * Determine whether a user should receive a push notification at `now`.
 *
 * A user is notified when their EFFECTIVE UTC send-hour matches the current
 * UTC hour (from `now`).
 *
 * - `pushNotificationHour` is the stored local preferred hour (0-23), or
 *   null for "no preference".
 * - `timezone` is the user's IANA timezone (or null for UTC).
 * - `now` is the reference timestamp (the moment the route is executing).
 *
 * NULL preference → effective UTC hour is PUSH_DEFAULT_HOUR_UTC (8).
 * Set preference → converted from local to UTC via `localHourToUtcHour`.
 */
export function shouldSendToUser(
  pushNotificationHour: number | null,
  timezone: string | null,
  now: Date,
): boolean {
  const nowUtcHour = currentUtcHour(now);

  let effectiveUtcHour: number;
  if (pushNotificationHour === null) {
    // No preference: use the default, which aligns with the current cron.
    effectiveUtcHour = PUSH_DEFAULT_HOUR_UTC;
  } else {
    effectiveUtcHour = localHourToUtcHour(pushNotificationHour, timezone, now);
  }

  return nowUtcHour === effectiveUtcHour;
}
