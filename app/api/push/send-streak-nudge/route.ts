import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/auth/bearerAuth";
import webpush from "web-push";
import { createTranslator as _createTranslatorRaw } from "use-intl/core";
import { todayInTimezone } from "@/lib/utils/format-date";
import { localHourToUtcHour, currentUtcHour, PUSH_DEFAULT_HOUR_UTC } from "@/lib/push/notificationHour";
import { isEligibleForStreakNudge } from "@/lib/push/streakNudgePredicate";
import { validateStreakProtection, effectiveStreakDates, type StreakProtection } from "@/lib/streak/tokens";
import { computeStreak } from "@/lib/streak/compute";

// use-intl's createTranslator has deeply generic types that conflict with the
// simple Record<string, unknown> messages shape used here; cast to a plain
// callable, same as app/api/push/send-daily/route.ts.
const _createTranslator = _createTranslatorRaw as unknown as (
  opts: { locale: string; messages: Record<string, unknown> }
) => (key: string, values?: Record<string, unknown>) => string;

/**
 * Late-day "streak at risk" push route (#1950).
 *
 * Triggered by the `web-push-streak-nudge` pg_cron job (migration 047) via
 * `net.http_post`, hourly, reusing the `cron_shared_secret` Vault value that
 * migration 028 already provisions.
 *
 * This is a SECOND, independent daily notification from send-daily/route.ts
 * (#1056 / #1315): it only fires for users who have explicitly opted in
 * (`streakNudgeEnabled` in settings), have an active streak that is
 * genuinely at risk today (see `isEligibleForStreakNudge`), and have not
 * already reviewed today.
 *
 * AUTH MODEL: identical to send-daily - `Authorization: Bearer
 * <CRON_SHARED_SECRET>` via `isAuthorized` (401 on mismatch), 503 when any
 * required env var (VAPID keys/subject, Supabase URL/service-role key,
 * CRON_SHARED_SECRET) is missing.
 *
 * GATES (in order, cheapest-first so we do the least DB work per user):
 *   A. Opt-in + push subscription: `streakNudgeEnabled === true` in the
 *      user's settings JSONB (default false) AND at least one
 *      `push_subscriptions` row (implicit via `get_push_targets`).
 *   B. Late-hour fan-out: the user's LOCAL time is `STREAK_NUDGE_LOCAL_HOUR`
 *      this run, via `localHourToUtcHour` (same DST-safe Intl conversion
 *      `notificationHour.ts` uses for the primary reminder).
 *   C. Collision guard: skip if the primary reminder's effective UTC hour is
 *      within 3 hours of the nudge's effective UTC hour for this user, so
 *      the two pushes never land close together.
 *   D. Reviewed-today: drop users who already reviewed today (tz-aware,
 *      bucketed the same way send-daily buckets due-card queries), via the
 *      `get_push_reviewed_today` RPC (migration 047).
 *   E. Genuinely-at-risk streak: `get_push_streak_days` (migration 047)
 *      supplies the raw `streak_days` rows; `isEligibleForStreakNudge`
 *      (lib/push/streakNudgePredicate.ts) derives the streak length via the
 *      existing `lib/streak/` primitives and applies the honesty check (a
 *      protection token that would auto-bridge tonight's gap suppresses the
 *      nudge - #1950 ux/privacy sign-off).
 *
 * Uses the same `get_push_targets` RPC (migration 046) as send-daily so the
 * cross-user read surface for subscriptions + settings stays a single
 * narrowed function, not a second bespoke one.
 */

// Same runtime note as send-daily: must run on Node (not Edge) for the
// `web-push` package's ES256 JWT signing via Node's `crypto` module.

/** Fixed local hour (0-23) for the nudge send, v1 (#1950 planning comment). */
export const STREAK_NUDGE_LOCAL_HOUR = 20;

/**
 * Minimum gap (in UTC hours) required between the primary daily reminder's
 * effective send hour and the nudge's effective send hour for a given user,
 * below which the nudge is suppressed for that user this run (#1950 ux
 * sign-off - avoid two pushes landing close together).
 */
export const COLLISION_GUARD_HOURS = 3;

type PushPayload = {
  title: string;
  body: string;
  url: string;
};

/**
 * The `pushStreak` message namespace loaded from the English catalogue.
 * Mirrors `getPushDailyMessages` in send-daily/route.ts exactly: the cron has
 * no per-user `appLocale`, so notification chrome stays English for now (the
 * keys exist in all four catalogues with identical English copy, same as
 * `pushDaily`, so a future locale swap is a one-line change).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pushStreakMessages: Record<string, any> | null = null;
async function getPushStreakMessages(): Promise<Record<string, unknown>> {
  if (_pushStreakMessages === null) {
    const mod = (await import("@/messages/en.json")) as {
      default: Record<string, unknown>;
    };
    _pushStreakMessages = mod.default.pushStreak as Record<string, unknown>;
  }
  return _pushStreakMessages;
}

/**
 * Builds the user-facing body string for the streak-nudge push. Pure aside
 * from the message-catalogue load, so it is unit-testable without touching
 * the network. British English copy, no em dashes (per AGENTS.md).
 */
export async function buildStreakNudgeMessage(streakDays: number): Promise<PushPayload> {
  const messages = await getPushStreakMessages();
  const t = _createTranslator({ locale: "en", messages });

  const title = t("title");
  const body = t("body", { days: streakDays });
  const url = "/";

  return { title, body, url };
}

/**
 * Row shape returned by `get_push_targets` (migration 046) - identical to
 * send-daily's `PushTargetRow`. Duplicated here (rather than importing from
 * the sibling route module) to keep the two routes independently deployable
 * and because importing across `app/api/**` route modules is discouraged
 * (each route is its own bundle entry point).
 */
type PushTargetRow = {
  subscription_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  timezone: string | null;
  settings: Record<string, unknown> | null;
  push_notification_hour: number | null;
};

/** Row shape returned by `get_push_streak_days` (migration 047). */
type StreakDayRow = {
  user_id: string;
  review_date: string;
};

/** Row shape returned by `get_push_reviewed_today` (migration 047). */
type ReviewedTodayRow = {
  user_id: string;
};

/**
 * Parse the `streakNudgeEnabled` opt-in flag from the raw settings JSONB.
 * Default false: absent/malformed values never enable the nudge (matches
 * `DEFAULT_SETTINGS.streakNudgeEnabled` in lib/settings/persistence.ts).
 */
function parseStreakNudgeEnabled(rawSettings: Record<string, unknown> | null): boolean {
  if (!rawSettings || typeof rawSettings !== "object") return false;
  return rawSettings.streakNudgeEnabled === true;
}

/**
 * Parse the `streakProtection` blob from the raw settings JSONB, defaulting
 * defensively via `validateStreakProtection` (same parser the client uses).
 */
function parseStreakProtectionField(rawSettings: Record<string, unknown> | null): StreakProtection {
  if (!rawSettings || typeof rawSettings !== "object") {
    return validateStreakProtection(null);
  }
  return validateStreakProtection(rawSettings.streakProtection);
}

export async function POST(request: Request) {
  const sharedSecret = process.env.CRON_SHARED_SECRET;
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !sharedSecret ||
    !vapidPublicKey ||
    !vapidPrivateKey ||
    !vapidSubject ||
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return NextResponse.json(
      { ok: false, error: "misconfigured" },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, sharedSecret)) {
    return new NextResponse(null, { status: 401 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const admin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Step 1: fetch every push subscription + settings, same RPC send-daily uses.
  const { data: targetsData, error: targetsError } =
    await admin.rpc("get_push_targets");
  if (targetsError || !targetsData) {
    return NextResponse.json(
      { ok: false, error: "targets_query_failed" },
      { status: 502 },
    );
  }
  const targets = targetsData as PushTargetRow[];
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  // Gate A: opt-in. Only users with streakNudgeEnabled === true continue.
  const optedInTargets = targets.filter((t) => parseStreakNudgeEnabled(t.settings));
  if (optedInTargets.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  const subscriptions = optedInTargets.map((t) => ({
    id: t.subscription_id,
    user_id: t.user_id,
    endpoint: t.endpoint,
    p256dh: t.p256dh,
    auth_secret: t.auth_secret,
  }));

  const timezoneByUser = new Map<string, string>();
  const streakProtectionByUser = new Map<string, StreakProtection>();
  const pushHourByUser = new Map<string, number | null>();
  for (const row of optedInTargets) {
    if (row.timezone) timezoneByUser.set(row.user_id, row.timezone);
    streakProtectionByUser.set(row.user_id, parseStreakProtectionField(row.settings));
    pushHourByUser.set(row.user_id, row.push_notification_hour ?? null);
  }

  const now = new Date();

  // Gate B: late-hour fan-out. The user's local clock must currently read
  // STREAK_NUDGE_LOCAL_HOUR (DST-safe via localHourToUtcHour).
  //
  // Gate C: collision guard. Compare the nudge's effective UTC hour against
  // the PRIMARY reminder's effective UTC hour for the same user (NULL
  // preference → PUSH_DEFAULT_HOUR_UTC, same fallback send-daily uses) and
  // skip if they land within COLLISION_GUARD_HOURS of each other on the
  // 24-hour clock (circular distance, so e.g. 23:00 and 01:00 are 2 hours
  // apart, not 22).
  const nowUtcHour = currentUtcHour(now);
  const filteredSubscriptions = subscriptions.filter((sub) => {
    const tz = timezoneByUser.get(sub.user_id) ?? null;

    const nudgeUtcHour = localHourToUtcHour(STREAK_NUDGE_LOCAL_HOUR, tz, now);
    if (nudgeUtcHour !== nowUtcHour) return false;

    const preferredHour = pushHourByUser.get(sub.user_id) ?? null;
    const dailyUtcHour =
      preferredHour === null
        ? PUSH_DEFAULT_HOUR_UTC
        : localHourToUtcHour(preferredHour, tz, now);

    const rawDiff = Math.abs(nudgeUtcHour - dailyUtcHour);
    const circularDiff = Math.min(rawDiff, 24 - rawDiff);
    if (circularDiff < COLLISION_GUARD_HOURS) return false;

    return true;
  });

  if (filteredSubscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  const activeUserIds = Array.from(new Set(filteredSubscriptions.map((s) => s.user_id)));

  // Gate D: reviewed-today. Bucket by "today in the user's own timezone" so
  // each distinct calendar date is queried at most once, same pattern as
  // send-daily's usersByDueDate bucketing.
  const usersByToday = new Map<string, string[]>();
  for (const userId of activeUserIds) {
    const tz = timezoneByUser.get(userId) ?? "UTC";
    const today = todayInTimezone(tz, now);
    const bucket = usersByToday.get(today);
    if (bucket) bucket.push(userId);
    else usersByToday.set(today, [userId]);
  }

  const reviewedTodaySet = new Set<string>();
  const todayByUser = new Map<string, string>();
  for (const [today, userIds] of usersByToday) {
    for (const userId of userIds) todayByUser.set(userId, today);

    const { data: reviewedData, error: reviewedError } = await admin.rpc(
      "get_push_reviewed_today",
      { user_ids: userIds, today_input: today },
    );
    if (reviewedError || reviewedData === null) {
      return NextResponse.json(
        { ok: false, error: "reviewed_today_query_failed" },
        { status: 502 },
      );
    }
    for (const row of reviewedData as ReviewedTodayRow[]) {
      reviewedTodaySet.add(row.user_id);
    }
  }

  const notReviewedUserIds = activeUserIds.filter((id) => !reviewedTodaySet.has(id));
  if (notReviewedUserIds.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  // Gate E: genuinely-at-risk streak. Fetch every streak_days row for the
  // remaining candidates in one call and group by user.
  const { data: streakDaysData, error: streakDaysError } = await admin.rpc(
    "get_push_streak_days",
    { user_ids: notReviewedUserIds },
  );
  if (streakDaysError || streakDaysData === null) {
    return NextResponse.json(
      { ok: false, error: "streak_days_query_failed" },
      { status: 502 },
    );
  }

  const streakDaysByUser = new Map<string, string[]>();
  for (const row of streakDaysData as StreakDayRow[]) {
    const bucket = streakDaysByUser.get(row.user_id);
    if (bucket) bucket.push(row.review_date);
    else streakDaysByUser.set(row.user_id, [row.review_date]);
  }

  const eligibleUserIds = new Set<string>();
  const streakLengthByUser = new Map<string, number>();
  for (const userId of notReviewedUserIds) {
    const streakDays = streakDaysByUser.get(userId) ?? [];
    const streakProtection = streakProtectionByUser.get(userId) ?? validateStreakProtection(null);
    const today = todayByUser.get(userId) ?? todayInTimezone("UTC", now);

    const eligible = isEligibleForStreakNudge({
      streakDays,
      streakProtection,
      reviewedToday: false,
      today,
    });
    if (eligible) {
      eligibleUserIds.add(userId);
      // Effective streak length for the copy: `activeStreak` is recomputed
      // inline here rather than threading it back out of the predicate,
      // since it's a cheap pure call over already-fetched data.
      streakLengthByUser.set(userId, computeDisplayStreak(streakDays, streakProtection, today));
    }
  }

  const finalSubscriptions = filteredSubscriptions.filter((sub) =>
    eligibleUserIds.has(sub.user_id),
  );

  if (finalSubscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  // Step: send. Dead subscriptions (410/404) are deleted so the next cron
  // run doesn't retry them, same cleanup loop as send-daily.
  const toDelete: string[] = [];
  let sent = 0;
  for (const sub of finalSubscriptions) {
    const streakDays = streakLengthByUser.get(sub.user_id) ?? 0;
    const payload = await buildStreakNudgeMessage(streakDays);
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
        },
        JSON.stringify(payload),
      );
      sent++;
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        toDelete.push(sub.id);
        continue;
      }
      console.warn("[push] streak-nudge sendNotification failed", { id: sub.id, status });
    }
  }

  let deleted = 0;
  if (toDelete.length > 0) {
    const { error: deleteError, count } = await admin
      .from("push_subscriptions")
      .delete({ count: "exact" })
      .in("id", toDelete);
    if (!deleteError) deleted = count ?? toDelete.length;
  }

  return NextResponse.json({ ok: true, sent, deleted });
}

/**
 * Recompute the user-facing streak length for the notification copy. Reuses
 * the same `effectiveStreakDates` + `computeStreak` pairing
 * `isEligibleForStreakNudge` uses internally (single source of truth for
 * streak derivation - see AGENTS.md "Single source of truth for shared
 * concepts").
 */
function computeDisplayStreak(
  streakDays: string[],
  streakProtection: StreakProtection,
  today: string,
): number {
  return computeStreak(effectiveStreakDates(streakDays, streakProtection.spendDates), today);
}
