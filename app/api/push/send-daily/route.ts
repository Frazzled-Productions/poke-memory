import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/sync/paginatedFetch";
import webpush from "web-push";
import { createTranslator as _createTranslatorRaw } from "use-intl/core";
import { todayInTimezone } from "@/lib/utils/format-date";
import { isCardEligible } from "@/lib/eligibility";
import { scopeMatchesEntry, resolveAnchorId } from "@/lib/eligibility/scopePredicate";
import { SCOPE_LOOKUP } from "@/lib/pokemon/scopeLookup";
import type { PracticeScope } from "@/lib/review/scope";
import { EMPTY_SCOPE, isScopeEmpty, parseFormCategoryFilter } from "@/lib/eligibility/scopeConstants";
import { shouldSendToUser, PUSH_DEFAULT_HOUR_UTC } from "@/lib/push/notificationHour";
import {
  SUPPORTED_LOCALES,
  LOCALE_ENDONYMS,
  type AppLocale,
} from "@/i18n/locales";

// use-intl's createTranslator has deeply generic types that conflict with the
// simple Record<string, unknown> messages shape used here; cast to a plain
// callable to keep the call sites readable without requiring type imports.
const _createTranslator = _createTranslatorRaw as unknown as (
  opts: { locale: string; messages: Record<string, unknown> }
) => (key: string, values?: Record<string, unknown>) => string;

/**
 * Daily Web Push reminder route (#1056, per-user hour gate: #1315).
 *
 * Triggered by the `web-push-daily-reminders` pg_cron job (migration 028)
 * via `net.http_post` with a Bearer header carrying the
 * `cron_shared_secret` Vault value.
 *
 * CURRENT CRON SCHEDULE: once per day at 08:00 UTC (0 8 * * *).
 * This route now supports per-user notification hours (#1315) but the cron
 * has NOT yet been changed to hourly - that is a deliberate split to avoid
 * a deploy-ordering hazard (the phase-2 migration must only be applied
 * AFTER this PR is promoted to production). See the follow-up issue filed
 * alongside #1315 for the phase-2 cron change.
 *
 * INTERIM BEHAVIOUR:
 *   - Users with no preferred hour (NULL → effective UTC 8) continue to
 *     receive their notification at 08:00 UTC exactly as before.
 *   - Users who set a non-8-UTC-equivalent preferred hour are DORMANT
 *     until the phase-2 cron flip activates hourly delivery.
 *   - No user receives a duplicate notification in the interim.
 *
 * AFTER PHASE-2 (hourly cron):
 *   The cron fires at `0 * * * *`. At each UTC hour H, only users whose
 *   effective UTC send-hour equals H are notified. Each user receives at
 *   most one notification per day, at their chosen local hour.
 *
 * This handler fans out per-user Web Push notifications for every
 * `push_subscriptions` row whose owning user:
 *   1. Matches the current UTC hour gate (see shouldSendToUser / #1315), AND
 *   2. Has at least one card due today in their own timezone.
 *
 * Why a route handler instead of a Supabase Edge Function: VAPID JWTs are
 * ECDSA P-256 (ES256) and pgcrypto / pgsodium can't produce that shape, so
 * the cron call has to land somewhere with a real crypto stack. Keeping
 * this in the Next.js codebase means one deploy pipeline, one set of env
 * vars, and one place to test the auth + payload encryption logic.
 *
 * AUTH MODEL
 *   1. Caller authenticates via `Authorization: Bearer <CRON_SHARED_SECRET>`.
 *      Any other value (or missing header) returns 401. The shared secret
 *      lives in both Vercel env (`CRON_SHARED_SECRET`) and Supabase Vault
 *      (`cron_shared_secret`); they must match exactly.
 *   2. Inside the route, we use the SUPABASE_SERVICE_ROLE_KEY to read
 *      across every user's `push_subscriptions` row. Row-level security is
 *      bypassed by design - the cron has no `auth.uid()` to authorise as,
 *      and the route's only privileged operation is reading subscriptions
 *      + computing due counts + sending pushes.
 */

// Note: this route must run on Node.js (not Edge) because the `web-push`
// package relies on the Node `crypto` module for ES256 JWT signing and
// payload encryption. Next.js 16's Cache Components mode forbids the
// per-route `runtime` segment config, so we rely on the project-wide
// default Node runtime here.

/** JSON shape of the push payload delivered to the SW push handler. */
type PushPayload = {
  title: string;
  body: string;
  url: string;
};

/**
 * Per-locale due count for a single user.
 * Keys are AppLocale values; only locales with due > 0 are present.
 */
export type LocaleDueMap = Map<AppLocale, number>;

/**
 * The `pushDaily` message namespace loaded from the English catalogue.
 * Used by `createTranslator` to build notification copy (#1504, Option B).
 * The cron has no per-user `appLocale`, so the notification chrome stays
 * English for now; the keys exist in all four catalogues so a future locale
 * swap is a one-line change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pushDailyMessages: Record<string, any> | null = null;
async function getPushDailyMessages(): Promise<Record<string, unknown>> {
  if (_pushDailyMessages === null) {
    // Dynamic import keeps the messages bundle out of every other route.
    const mod = (await import("@/messages/en.json")) as {
      default: Record<string, unknown>;
    };
    _pushDailyMessages = mod.default.pushDaily as Record<string, unknown>;
  }
  return _pushDailyMessages;
}

/**
 * Constant-time bearer-header comparison. Plain `===` on the assembled
 * `Bearer <secret>` string leaks the shared secret's length and prefix via
 * the early-exit timing characteristic of JavaScript string equality. We
 * compare equal-length byte buffers via `crypto.timingSafeEqual` instead.
 *
 * The early length check is fine. `timingSafeEqual` REQUIRES both buffers to
 * be the same length (it throws otherwise), and an attacker who learns the
 * fixed-length total (`'Bearer '` + secret) buys nothing actionable since
 * `CRON_SHARED_SECRET` is generated by `openssl rand -base64 32` and so has
 * a constant length per deploy.
 */
function isAuthorized(headerValue: string | null, secret: string): boolean {
  if (!headerValue || !secret) return false;
  const expected = `Bearer ${secret}`;
  if (headerValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(headerValue), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Builds the user-facing body string for the daily reminder. Kept pure so
 * we can unit test it without touching the network or DB.
 *
 * British English copy. No em dashes (per AGENTS.md "Punctuation").
 *
 * Supersedes #1480's single-locale scoping (#1504):
 *   - `localeDueCounts` maps each learning locale to its due count. Only
 *     locales with due > 0 should be present (the route omits zero-due
 *     locales from the map before calling this function).
 *   - Single learning language (only one locale in the map, or all others
 *     are zero): unchanged body feel, using the catalogue `singleDue*` keys.
 *   - Multiple learning languages with due > 0: global total leads; breakdown
 *     is ordered by due-count descending, ties broken by the canonical locale
 *     order (en, ja, zh-Hans, zh-Hant). Endonyms from `LOCALE_ENDONYMS`.
 *   - Exactly one due locale among multiple enrolled: the compact
 *     "N cards due in <Language>" form (avoids a one-item breakdown list).
 *   - Zero due across all locales: falls through to the new-only copy
 *     (same as before - no per-language new-card breakdown in v1).
 *
 * New-card count: GLOBAL for v1 (per-locale new-card capping is a larger
 * modelling question; see #1504 PR body for the rationale).
 */
export async function buildDailyMessage(
  localeDueCounts: LocaleDueMap,
  newEstimate: number = 0,
): Promise<PushPayload> {
  const messages = await getPushDailyMessages();
  const t = _createTranslator({ locale: "en", messages });

  const title = t("title");
  const url = "/";

  // Sum the global total across all (non-zero) due locales.
  let dueTotal = 0;
  for (const count of localeDueCounts.values()) dueTotal += count;

  // ── Zero due: fall through to new-only copy (unchanged path) ─────────────
  if (dueTotal === 0) {
    const body = t("newOnly", { newEstimate });
    return { title, body, url };
  }

  // ── Determine the breakdown: sort by due desc, tie-break by canonical order ─
  const canonicalOrder = SUPPORTED_LOCALES as readonly AppLocale[];
  const sorted = Array.from(localeDueCounts.entries())
    .filter(([, c]) => c > 0)
    .sort(([locA, countA], [locB, countB]) => {
      if (countB !== countA) return countB - countA;
      return canonicalOrder.indexOf(locA) - canonicalOrder.indexOf(locB);
    });

  // ── Single due-locale: compact form ──────────────────────────────────────
  // (Only one locale has due > 0, regardless of how many the user is enrolled in.)
  if (sorted.length === 1) {
    const [locale, due] = sorted[0];
    const language = LOCALE_ENDONYMS[locale];
    let body: string;
    if (newEstimate > 0) {
      body = t("singleDueNew", { due, language, newEstimate });
    } else {
      body = t("singleDueOnly", { due, language });
    }
    return { title, body, url };
  }

  // ── Multiple due-locales: global total + breakdown ────────────────────────
  // Build breakdown string: "<Endonym> N, <Endonym> N, ..."
  // Plain comma join (no Oxford comma via Intl.ListFormat) for scannability.
  const breakdownParts = sorted.map(([locale, count]) =>
    t("breakdownItem", { language: LOCALE_ENDONYMS[locale], count }),
  );
  const breakdown = breakdownParts.join(", ");

  let body: string;
  if (newEstimate > 0) {
    body = t("multiDueNew", { dueTotal, breakdown, newEstimate });
  } else {
    body = t("multiDueOnly", { dueTotal, breakdown });
  }
  return { title, body, url };
}

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

/**
 * Subset of the `user_settings` row shape. `settings` is the JSONB blob
 * carrying per-user card-type enabled flags and daily new-card caps.
 * `timezone` is a scalar column (migration 019).
 * `push_notification_hour` is a scalar column (migration 030, #1315) storing
 * the user's preferred LOCAL hour (0-23) for the daily reminder. NULL means
 * "no preference" - falls back to PUSH_DEFAULT_HOUR_UTC (8).
 */
type SettingsRow = {
  user_id: string;
  timezone: string | null;
  settings: Record<string, unknown> | null;
  push_notification_hour: number | null;
};

// ---------------------------------------------------------------------------
// Scope lookup map - built once at module load from the compact lookup table.
// Keyed by pokemon id (same as card subject_key for name/reverse/cry cards;
// for evolution cards we resolve the pre-evo anchor id via resolveAnchorId).
// ---------------------------------------------------------------------------
const SCOPE_LOOKUP_MAP = new Map(SCOPE_LOOKUP.map((e) => [e.id, e]));

/**
 * The per-user eligibility flags extracted from the `settings` JSONB.
 * Mirrors the relevant fields from `UserSettings` in lib/settings/persistence.ts.
 * Defaults match `DEFAULT_SETTINGS` so users with missing/partial JSONB
 * fall back to the same behaviour as the app itself.
 *
 * Name and reverse are always on since #1234. They are not represented here;
 * `isCardEligible` and `computeNewEstimate` treat them as always active.
 *
 * #1504: `pokemonNameLocale` replaced by `learningLocales` (the full learning
 * set from the multi-language model). The route counts due cards across ALL
 * learning locales and builds a per-language breakdown. `activePokemonNameLocale`
 * is device-local (a DEVICE_LOCAL_KEYS entry, not reliably in cloud JSONB)
 * and is NOT read here - ordering is by due-count desc, not active-first.
 */
type UserEligibility = {
  evolutionCardsEnabled: boolean;
  reverseEvolutionCardsEnabled: boolean;
  cryCardsEnabled: boolean;
  alternateFormsEnabled: boolean;
  maxNewPerDay: number;
  maxNewEvolutionPerDay: number;
  maxNewReversePerDay: number;
  maxNewCryPerDay: number;
  /**
   * Practice scope axes persisted to `user_settings.settings` JSONB (#1159).
   * Empty scope (all axes empty) means no restriction - all species are eligible.
   * Defaults to EMPTY_SCOPE so users without a stored scope value see all cards.
   */
  practiceScope: PracticeScope;
  /**
   * The user's full learning-locale set (#1504, supersedes #1480's
   * `pokemonNameLocale` single-locale field).
   *
   * Parsed from the `learningLocales` JSONB array (synced via union-merge in
   * #1568). English is always present and unremovable; the default is `["en"]`
   * so pre-#1484 users see the correct en-only behaviour.
   *
   * Accepted values: `'en' | 'ja' | 'zh-Hans' | 'zh-Hant'` (DB CHECK constraint).
   * Any invalid element is silently dropped.
   */
  learningLocales: AppLocale[];
};

/** DEFAULT_SETTINGS-aligned fallbacks, used when a JSONB field is missing or invalid. */
const DEFAULT_ELIGIBILITY: UserEligibility = {
  evolutionCardsEnabled: true,
  reverseEvolutionCardsEnabled: false,
  cryCardsEnabled: false,
  alternateFormsEnabled: false,
  maxNewPerDay: 10,
  maxNewEvolutionPerDay: 5,
  maxNewReversePerDay: 10,
  maxNewCryPerDay: 10,
  practiceScope: EMPTY_SCOPE,
  // Pre-#1484 users have no `learningLocales` JSONB key; default to ["en"]
  // which matches migration 029's backfill of locale = 'en' for all legacy rows.
  learningLocales: ["en"],
};

/**
 * Parse a `PracticeScope` from a raw JSONB value.
 *
 * Permissive: invalid / missing sub-fields default to the empty-axis value.
 * Mirrors the structure of `validatePracticeScope` in
 * `lib/settings/persistence.ts` without importing that module (which carries
 * heavy seed imports via `lib/review/scope.ts` when the full `SEED_POKEMON`
 * constant is involved).
 *
 * Returns `EMPTY_SCOPE` on absent / malformed input so users with no stored
 * scope see all cards - same defensive default as the app itself.
 */
function parsePracticeScope(raw: unknown): PracticeScope {
  if (typeof raw !== "object" || raw === null) return EMPTY_SCOPE;
  const obj = raw as Record<string, unknown>;

  const gens: number[] = [];
  if (Array.isArray(obj.gens)) {
    const seen = new Set<number>();
    for (const g of obj.gens) {
      if (typeof g !== "number" || !Number.isInteger(g) || g < 1 || g > 9) continue;
      if (seen.has(g)) continue;
      seen.add(g);
      gens.push(g);
    }
  }

  const types: string[] = [];
  if (Array.isArray(obj.types)) {
    for (const t of obj.types) {
      if (typeof t === "string") types.push(t);
    }
  }

  const VALID_PRESETS = new Set(["starters", "legendaries", "incomplete-chains"]);
  const presets: PracticeScope["presets"] = [];
  if (Array.isArray(obj.presets)) {
    const seen = new Set<string>();
    for (const p of obj.presets) {
      if (typeof p !== "string" || !VALID_PRESETS.has(p) || seen.has(p)) continue;
      seen.add(p);
      presets.push(p as PracticeScope["presets"][number]);
    }
  }

  const formCategories = parseFormCategoryFilter(obj.formCategories);

  const games: string[] = [];
  if (Array.isArray(obj.games)) {
    const seen = new Set<string>();
    for (const g of obj.games) {
      if (typeof g !== "string" || seen.has(g)) continue;
      seen.add(g);
      games.push(g);
    }
  }

  return { gens, types, presets, formCategories, games };
}

/**
 * Parse the `learningLocales` array from the raw JSONB blob.
 *
 * Only accepts the four DB-valid locale values. Invalid elements are silently
 * dropped. Deduplicates. Always includes "en" (English is unremovable) so
 * even a completely invalid array falls back to the English-only default.
 */
function parseLearningLocales(raw: unknown): AppLocale[] {
  const validSet = new Set<string>(SUPPORTED_LOCALES);
  const out: AppLocale[] = [];
  const seen = new Set<AppLocale>();
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string" && validSet.has(v) && !seen.has(v as AppLocale)) {
        const locale = v as AppLocale;
        seen.add(locale);
        out.push(locale);
      }
    }
  }
  // English is unremovable - ensure it's always present.
  if (!seen.has("en")) out.unshift("en");
  return out;
}

/**
 * Parse the per-user eligibility settings from the raw JSONB blob. Permissive:
 * a missing or non-boolean field falls back to the DEFAULT_SETTINGS value.
 * Only the fields that affect the daily-push due count are extracted.
 */
function parseEligibility(rawSettings: Record<string, unknown> | null): UserEligibility {
  if (!rawSettings || typeof rawSettings !== "object") return { ...DEFAULT_ELIGIBILITY };
  // Bind to a non-null local so nested functions narrow cleanly.
  const s: Record<string, unknown> = rawSettings;
  function boolField(key: keyof UserEligibility, defaultVal: boolean): boolean {
    const v = s[key];
    return typeof v === "boolean" ? v : defaultVal;
  }
  function numField(key: keyof UserEligibility, defaultVal: number): number {
    const v = s[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : defaultVal;
  }

  // #1504: parse learningLocales (supersedes the single pokemonNameLocale field
  // from #1480). Falls back to ["en"] for pre-#1484 records that have no
  // learningLocales key (migration 029 backfilled locale="en" for all rows).
  const learningLocales = parseLearningLocales(s.learningLocales);

  return {
    evolutionCardsEnabled:        boolField("evolutionCardsEnabled",        DEFAULT_ELIGIBILITY.evolutionCardsEnabled),
    reverseEvolutionCardsEnabled: boolField("reverseEvolutionCardsEnabled", DEFAULT_ELIGIBILITY.reverseEvolutionCardsEnabled),
    cryCardsEnabled:              boolField("cryCardsEnabled",              DEFAULT_ELIGIBILITY.cryCardsEnabled),
    alternateFormsEnabled:        boolField("alternateFormsEnabled",        DEFAULT_ELIGIBILITY.alternateFormsEnabled),
    maxNewPerDay:          numField("maxNewPerDay",          DEFAULT_ELIGIBILITY.maxNewPerDay),
    maxNewEvolutionPerDay: numField("maxNewEvolutionPerDay", DEFAULT_ELIGIBILITY.maxNewEvolutionPerDay),
    maxNewReversePerDay:   numField("maxNewReversePerDay",   DEFAULT_ELIGIBILITY.maxNewReversePerDay),
    maxNewCryPerDay:       numField("maxNewCryPerDay",       DEFAULT_ELIGIBILITY.maxNewCryPerDay),
    practiceScope: parsePracticeScope(s.practiceScope),
    learningLocales,
  };
}

/**
 * Returns true when a card row is eligible under the user's settings and
 * practice scope.
 *
 * Three gates, in order:
 *
 *   1. Card-type enabled flags + alt-forms toggle (delegated to
 *      `isCardEligible` from `lib/eligibility` - shared with the on-device
 *      PWA badge filter via `lib/review/scope.ts` `computeEligibleCardIds`).
 *
 *   2. Practice scope (gens / types / games / presets / formCategories) via
 *      `scopeMatchesEntry` from `lib/eligibility/scopePredicate` (#1159).
 *      An empty scope (all axes empty) passes every card.
 *
 *      The scope is anchored on the pre-evo species for evolution cards,
 *      matching the client-side behaviour in `cardMatchesScope` where
 *      evolution cards filter on `card.preEvoId`.
 *
 *      Unknown card_type values pass both gates so future card types are not
 *      silently dropped while we await a route update.
 *
 * Card-type gates:
 *   - `name`                   → always on (#1234)
 *   - `reverse`                → always on (#1234)
 *   - `evolution-edge`         → evolutionCardsEnabled
 *   - `reverse-evolution-edge` → reverseEvolutionCardsEnabled
 *   - `cry`                    → cryCardsEnabled
 *
 * Alt-forms gate (when `alternateFormsEnabled` is false):
 *   - For `name` / `reverse` / `cry` cards, the subject_key is the numeric
 *     species id. Ids >= 10000 are alt-form variants and are excluded.
 *   - For `evolution-edge` / `reverse-evolution-edge` cards, the subject_key
 *     is `"<fromId>>><toId>"`. Exclude if either endpoint id >= 10000.
 */
function rowIsEligible(
  cardType: string,
  subjectKey: string,
  eligibility: UserEligibility,
): boolean {
  // Gate 1: card-type flags + alt-forms toggle.
  if (!isCardEligible({ cardType, subjectKey }, eligibility)) return false;

  // Gate 2: practice scope. Skip when scope is empty (fast path).
  const scope = eligibility.practiceScope;
  if (isScopeEmpty(scope)) return true;

  const anchorId = resolveAnchorId(cardType, subjectKey);
  if (anchorId === null) {
    // Unknown card type - pass through (forward-compatible, same as gate 1).
    return true;
  }

  const entry = SCOPE_LOOKUP_MAP.get(anchorId);
  if (entry === undefined) {
    // Species not in lookup (e.g. a legacy retired card id). Pass through
    // defensively rather than silently excluding a potentially valid card.
    return true;
  }

  return scopeMatchesEntry(entry, scope);
}

/**
 * Compute the capped new-card estimate for a user.
 *
 * For each enabled card direction, the estimate is:
 *   min(maxNewPerDay[direction], maxNewPerDay[direction] - startedTodayCount[direction])
 *
 * `startedTodayCount[direction]` is the count of `card_reviews` rows for
 * this user where `first_seen = today` and the row passes the eligibility
 * gate - i.e. cards the user has already started during today's session.
 * Subtracting these prevents double-counting cards that are new-and-due
 * (first introduced today, due today).
 *
 * The result is floor'd at 0 so a user who has already hit their daily cap
 * contributes 0 to the estimate rather than a negative number.
 *
 * Evolution bucket: `limitBucket` in `lib/review/session.ts` maps
 * `"reverse-evolution"` -> `"evolution"`, so forward-evolution and
 * reverse-evolution new cards share ONE `maxNewEvolutionPerDay` cap in the
 * real session. The estimate mirrors this: `maxNewEvolutionPerDay` is added
 * at most ONCE, when either direction (or both) is enabled (#1501).
 * The started-today count used for the evolution bucket is the sum of
 * `"evolution-edge"` and `"reverse-evolution-edge"` rows started today,
 * matching how `buildSessionQueues` accumulates `perType.evolution.newIntroducedToday`.
 *
 * New-card estimate is GLOBAL for v1 (#1504 - per-locale new-card capping
 * is a separate modelling question).
 */
function computeNewEstimate(
  startedTodayCounts: Record<string, number>,
  eligibility: UserEligibility,
): number {
  let estimate = 0;

  // Name and reverse are always on since #1234.
  estimate += Math.max(
    0,
    eligibility.maxNewPerDay - (startedTodayCounts["name"] ?? 0),
  );
  estimate += Math.max(
    0,
    eligibility.maxNewReversePerDay - (startedTodayCounts["reverse"] ?? 0),
  );

  // Evolution bucket: forward and reverse directions share one cap (see docstring).
  // Add the evolution term at most once, regardless of which directions are enabled.
  if (eligibility.evolutionCardsEnabled || eligibility.reverseEvolutionCardsEnabled) {
    const startedTodayEvo =
      (startedTodayCounts["evolution-edge"] ?? 0) +
      (startedTodayCounts["reverse-evolution-edge"] ?? 0);
    estimate += Math.max(
      0,
      eligibility.maxNewEvolutionPerDay - startedTodayEvo,
    );
  }

  if (eligibility.cryCardsEnabled) {
    estimate += Math.max(
      0,
      eligibility.maxNewCryPerDay - (startedTodayCounts["cry"] ?? 0),
    );
  }

  return estimate;
}

type DueRow = {
  user_id: string;
  card_type: string;
  subject_key: string;
  first_seen: string | null;
  /** Migration 029 locale column - part of the PK (#1480). */
  locale: string;
};

export async function POST(request: Request) {
  const sharedSecret = process.env.CRON_SHARED_SECRET;
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Misconfiguration → 503 (Service Unavailable). 500 would imply a crash
  // worth investigating; 503 conveys "the route is configured wrong" which
  // is the actual state. The cron job retries are bounded by pg_net's
  // own retry policy so this won't loop indefinitely.
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

  // Constant-time bearer check via timingSafeEqual; see isAuthorized above.
  // The 401 response carries no body so we don't reflect anything about the
  // configured route's expectations (header name, endpoint shape) back to an
  // unauthenticated caller. The pg_cron job that triggers the legitimate
  // call doesn't read the response body anyway.
  const authHeader = request.headers.get("authorization");
  if (!isAuthorized(authHeader, sharedSecret)) {
    return new NextResponse(null, { status: 401 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  // Service-role client. Bypasses RLS so we can read across all users in
  // a single round-trip. This client must NEVER reach the browser; the
  // route handler is the only consumer.
  const admin = createSupabaseAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Step 1: fetch every push subscription. The result fits comfortably in
  // memory at our scale (one row per device per signed-in user).
  const { data: subsData, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth_secret");
  if (subsError || !subsData) {
    return NextResponse.json(
      { ok: false, error: "subscriptions_query_failed" },
      { status: 502 },
    );
  }
  const subscriptions = subsData as SubscriptionRow[];
  if (subscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  // Step 2: resolve timezones, notification-hour preference, and per-user
  // eligibility settings. We widen the SELECT to include:
  //   - `settings` JSONB: card-type enabled flags, alt-forms toggle, and
  //     `learningLocales` (#1504 - the user's full learning-locale set).
  //   - `timezone`: scalar column (migration 019) - used for "today" bucketing
  //     and for converting the local preferred hour to UTC (#1315).
  //   - `push_notification_hour`: scalar column (migration 030, #1315) - the
  //     user's preferred local hour for the daily reminder (0-23 or NULL).
  // Users without a stored settings record fall back to DEFAULT_ELIGIBILITY.
  const uniqueUserIds = Array.from(new Set(subscriptions.map((s) => s.user_id)));
  const { data: settingsData, error: settingsError } = await admin
    .from("user_settings")
    .select("user_id, timezone, settings, push_notification_hour")
    .in("user_id", uniqueUserIds);
  if (settingsError) {
    return NextResponse.json(
      { ok: false, error: "settings_query_failed" },
      { status: 502 },
    );
  }
  const timezoneByUser = new Map<string, string>();
  const eligibilityByUser = new Map<string, UserEligibility>();
  const pushHourByUser = new Map<string, number | null>();
  for (const row of (settingsData ?? []) as SettingsRow[]) {
    if (row.timezone) timezoneByUser.set(row.user_id, row.timezone);
    eligibilityByUser.set(row.user_id, parseEligibility(row.settings));
    // Store the raw column value (null = no preference).
    pushHourByUser.set(row.user_id, row.push_notification_hour ?? null);
  }

  // Per-user UTC-hour gate (#1315). Evaluated against the current moment so
  // DST transitions are handled correctly via Intl.DateTimeFormat.
  //
  // INTERIM BEHAVIOUR: the cron is still daily (0 8 * * *), so this runs
  // once at 08:00 UTC. NULL users (no preference) use PUSH_DEFAULT_HOUR_UTC
  // (8) and match; users with a non-8-UTC-equivalent hour are dormant until
  // the phase-2 cron change flips delivery to hourly (migration 031).
  const now = new Date();
  const filteredSubscriptions = subscriptions.filter((sub) => {
    const tz = timezoneByUser.get(sub.user_id) ?? null;
    const preferredHour = pushHourByUser.get(sub.user_id) ?? null;
    return shouldSendToUser(preferredHour, tz, now);
  });

  if (filteredSubscriptions.length === 0) {
    // No subscriptions match the current UTC hour. This is expected while the
    // cron is still daily (only NULL/default-8 users arrive here at 08:00 UTC
    // and they all pass) - in phase-2 it means no user scheduled this hour.
    return NextResponse.json({ ok: true, sent: 0, deleted: 0 });
  }

  // Re-derive the unique user ids for the now-filtered subscription set so
  // Steps 3-4 only query for users who will actually receive a notification
  // this hour.
  const activeUserIds = Array.from(new Set(filteredSubscriptions.map((s) => s.user_id)));

  // Step 3: bucket active users by "today in their timezone" so each distinct
  // calendar date is queried at most once. At our scale this is at most
  // ~30 buckets covering every inhabited UTC offset.
  const usersByDueDate = new Map<string, string[]>();
  for (const userId of activeUserIds) {
    const tz = timezoneByUser.get(userId) ?? "UTC";
    const today = todayInTimezone(tz);
    const bucket = usersByDueDate.get(today);
    if (bucket) bucket.push(userId);
    else usersByDueDate.set(today, [userId]);
  }

  // Step 4: per-user, per-locale due counts and started-today counts in a
  // single round-trip per timezone bucket.
  //
  // We fetch `user_id`, `card_type`, `subject_key`, `locale`, and `first_seen`
  // for every row that satisfies `due_date <= today AND user_id IN bucket AND
  // hidden_since IS NULL`, then aggregate client-side.
  //
  // #1504 supersedes #1480's active-locale-only filter:
  //   OLD (#1480): skip rows whose locale !== eligibility.pokemonNameLocale
  //   NEW (#1504): skip rows whose locale is NOT in eligibility.learningLocales
  //   The per-locale accumulator is now a Map<locale, count> rather than a
  //   scalar, so we can build the per-language breakdown for the notification body.
  //
  // NOTE: lib/profile/dueCountCache.ts (the localStorage badge cache) is
  // intentionally NOT used here - it is client-side only and unreachable
  // from this Node cron route. The route computes due counts from the same
  // card_reviews aggregation it has always used; #1480 already threads the
  // `locale` column through DueRow. The per-locale breakdown is produced by
  // changing the accumulator from scalar to Map in the same loop.
  //
  // For each row we apply the per-user eligibility gate:
  //   - Locale membership: skip rows whose locale is not in the user's
  //     learningLocales set (before the eligibility gate to avoid inflating
  //     the count with ineligible rows from non-learning locales).
  //   - Card-type enable flags (evolutionCardsEnabled, etc.) from settings JSONB.
  //     Name and reverse are always on since #1234.
  //   - Alt-forms exclusion: when alternateFormsEnabled is false, rows with
  //     subject_key that resolves to an alt-form species id (>= 10000) are
  //     skipped (#1153).
  //
  // Rows where `first_seen = today` are still eligible (they count toward
  // the due total) but also counted in a separate bucket so we can compute
  // the new-card estimate (cards started today reduce the remaining new-card
  // headroom for that direction).

  // dueByUser: user_id → Map<locale, count>
  const dueByUser = new Map<string, Map<AppLocale, number>>();
  // startedTodayByUser: user_id → { card_type → count }
  const startedTodayByUser = new Map<string, Record<string, number>>();
  for (const [today, userIds] of usersByDueDate) {
    // Paginate to avoid the PostgREST 1000-row default cap. A single lapsed
    // user can exceed 1000 due rows, and the bucket covers multiple users.
    // ORDER BY user_id, due_date gives a stable total order for offset
    // pagination so rows don't shift/skip between pages.
    const dueData = await fetchAllPages<DueRow>((from, to) =>
      admin
        .from("card_reviews")
        .select("user_id, card_type, subject_key, first_seen, locale")
        .lte("due_date", today)
        .in("user_id", userIds)
        .is("hidden_since", null)
        .order("user_id", { ascending: true })
        .order("due_date", { ascending: true })
        .range(from, to),
    );
    if (!dueData) {
      return NextResponse.json(
        { ok: false, error: "due_query_failed" },
        { status: 502 },
      );
    }
    for (const row of dueData as DueRow[]) {
      const eligibility = eligibilityByUser.get(row.user_id) ?? DEFAULT_ELIGIBILITY;

      // Locale membership filter (#1504, supersedes #1480's single-locale drop):
      // count only rows whose locale is in the user's learning set. This is a
      // client-side per-user filter because the bucket query covers MULTIPLE
      // users each with potentially different learning sets. The filter must
      // come BEFORE the eligibility gate so ineligible rows from non-learning
      // locales do not inflate the due count.
      const rowLocale = row.locale as AppLocale;
      if (!eligibility.learningLocales.includes(rowLocale)) continue;

      if (!rowIsEligible(row.card_type, row.subject_key, eligibility)) continue;

      // Accumulate per-locale due count.
      if (!dueByUser.has(row.user_id)) {
        dueByUser.set(row.user_id, new Map<AppLocale, number>());
      }
      const localeMap = dueByUser.get(row.user_id)!;
      localeMap.set(rowLocale, (localeMap.get(rowLocale) ?? 0) + 1);

      // Track first_seen = today rows per card type so we can subtract them
      // from the new-card estimate (they're already started, not truly new).
      if (row.first_seen === today) {
        if (!startedTodayByUser.has(row.user_id)) {
          startedTodayByUser.set(row.user_id, {});
        }
        const counts = startedTodayByUser.get(row.user_id)!;
        counts[row.card_type] = (counts[row.card_type] ?? 0) + 1;
      }
    }
  }

  // Step 5: send. Dead subscriptions (410 Gone) and not-found (404) are
  // deleted so the next cron run doesn't try them again. All other errors
  // are logged and skipped - a single bad endpoint must not abort the
  // whole batch.
  const toDelete: string[] = [];
  let sent = 0;
  for (const sub of filteredSubscriptions) {
    const localeDueCounts: LocaleDueMap = dueByUser.get(sub.user_id) ?? new Map();
    const eligibility = eligibilityByUser.get(sub.user_id) ?? DEFAULT_ELIGIBILITY;
    const startedTodayCounts = startedTodayByUser.get(sub.user_id) ?? {};
    const newEstimate = computeNewEstimate(startedTodayCounts, eligibility);

    // Check global due total from the map.
    let dueTotal = 0;
    for (const count of localeDueCounts.values()) dueTotal += count;

    if (dueTotal <= 0 && newEstimate <= 0) continue;

    const payload = await buildDailyMessage(localeDueCounts, newEstimate);
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
      // Transient or non-fatal error - keep going so a single bad device
      // does not block the rest of the batch.
      console.warn("[push] sendNotification failed", { id: sub.id, status });
    }
  }

  // Step 6: cleanup. Best-effort - if the delete fails we'll retry on the
  // next cron cycle when the same endpoints fail again.
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
