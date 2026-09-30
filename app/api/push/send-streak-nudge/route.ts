import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { isAuthorized } from "@/lib/auth/bearerAuth";
import { fetchAllPages } from "@/lib/sync/paginatedFetch";
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
 *   D. Reviewed-today: `get_push_streak_days` (migration 047) supplies the
 *      raw `streak_days` rows for every remaining candidate in one call. A
 *      user has reviewed today when their own-timezone `today`
 *      (`todayInTimezone`, UTC fallback for a null/invalid tz) is in their
 *      streak days. `streak_days` is written in the user's local day, unlike
 *      the UTC `card_reviews.last_review` the old RPC matched (#2073), and
 *      `get_push_reviewed_today` is no longer called.
 *   E. Genuinely-at-risk streak: `isEligibleForStreakNudge`
 *      (lib/push/streakNudgePredicate.ts) receives that `reviewedToday`,
 *      derives the streak length via the existing `lib/streak/` primitives
 *      and applies the honesty check (a protection token that would
 *      auto-bridge tonight's gap suppresses the nudge - #1950 ux/privacy
 *      sign-off).
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

  // Gate D: reviewed-today, derived from `streak_days`, NOT `card_reviews.last_review`
  // (#2073). `last_review` is a UTC scheduling date set only on graduation or
  // lapse, so comparing it with the user's local date is wrong for anyone off
  // UTC and blind to learning-step practice. `streak_days.review_date` is
  // written in the user's own local day (`recordReview(localToday, ...)`), the
  // same calendar as `todayInTimezone(tz)` below, so membership is exact.
  // Fetch every streak_days row for the candidates and group by user. The
  // read is paginated (#2115): PostgREST caps a single response at 1000 rows
  // and that cap is shared across ALL candidate users, so an unpaginated read
  // would silently drop the last users' (and their latest) dates and cause
  // false "streak at risk" nudges. The full history is genuinely needed (the
  // streak length and protection maths walk it), so a since-date window is not
  // a correct fix. `ORDER BY user_id, review_date` is applied on the RPC result
  // (the unique key, a total order) so offset pages never skip or repeat rows.
  const streakDaysData = await fetchAllPages<StreakDayRow>((from, to) =>
    admin
      .rpc("get_push_streak_days", { user_ids: activeUserIds })
      .order("user_id", { ascending: true })
      .order("review_date", { ascending: true })
      .range(from, to),
  );
  if (streakDaysData === null) {
    return NextResponse.json(
      { ok: false, error: "streak_days_query_failed" },
      { status: 502 },
    );
  }

  // Each page is its own request/snapshot, so a concurrent streak_days write at
  // a page boundary can duplicate or skip a row. Accepted non-atomic race: a
  // duplicate is neutralised by the Set; a skip could at worst cause one false nudge.
  const streakDaySetsByUser = new Map<string, Set<string>>();
  for (const row of streakDaysData) {
    const bucket = streakDaySetsByUser.get(row.user_id);
    if (bucket) bucket.add(row.review_date);
    else streakDaySetsByUser.set(row.user_id, new Set([row.review_date]));
  }

  // Gate E: genuinely-at-risk streak, evaluated per user against their own
  // local "today".
  const eligibleUserIds = new Set<string>();
  const streakLengthByUser = new Map<string, number>();
  for (const userId of activeUserIds) {
    const streakDays = Array.from(streakDaySetsByUser.get(userId) ?? []);
    const streakProtection = streakProtectionByUser.get(userId) ?? validateStreakProtection(null);
    const today = todayInTimezone(timezoneByUser.get(userId) ?? "UTC", now);
    const reviewedToday = streakDays.includes(today);

    const eligible = isEligibleForStreakNudge({
      streakDays,
      streakProtection,
      reviewedToday,
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
