/**
 * merge_user_settings on D1 (design D3): the port of Postgres migrations 011,
 * 014, 023, 036 and 037 (the deep merge) plus the user_settings regression
 * guard of migration 038, which was a BEFORE UPDATE trigger and now runs here,
 * on the merged value, before the write.
 *
 * D1 has no interactive transactions, so read, merge, guard and write use
 * compare-and-swap on updated_at: the UPDATE only applies when updated_at still
 * holds the value that was read, and a lost race retries (at most 5 times).
 * Every write moves updated_at strictly forward, so the swap cannot be fooled
 * by two writes in the same millisecond.
 *
 * The user id always comes from the session (lib/db/gateway.ts), never from
 * the request.
 */
import type { D1DatabaseLike } from "../d1";
import { DbError, toDbError } from "../errors";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export const MERGE_MAX_ATTEMPTS = 5;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * public.jsonb_deep_merge (036): for each key of `patch`, recurse when both
 * sides are objects, otherwise overwrite. Arrays replace wholesale and a JSON
 * null in the patch SETS the key to null (SQLite's json_patch would delete it,
 * which is why this is not SQL).
 */
export function jsonDeepMerge(base: Json | undefined, patch: Json | undefined): JsonObject {
  const result: JsonObject = isObject(base) ? { ...base } : {};
  if (!isObject(patch)) return result;
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = isObject(value) && isObject(current) ? jsonDeepMerge(current, value) : value;
  }
  return result;
}

// ── Postgres operator semantics the 038 guard relies on ─────────────────────

/** `jsonb ->> key`: text of a value, null for a missing key or JSON null. */
function pgText(value: Json | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** `text::numeric`, raising 22P02 on text that is not a number, as Postgres does. */
function pgNumeric(text: string): number {
  const n = text.trim() === "" ? NaN : Number(text);
  if (!Number.isFinite(n)) {
    throw new DbError("22P02", `invalid input syntax for type numeric: "${text}"`);
  }
  return n;
}

const PG_TRUE = new Set(["t", "true", "y", "yes", "on", "1"]);
const PG_FALSE = new Set(["f", "false", "n", "no", "off", "0"]);

/** `text::boolean`: null stays null; text that is not a boolean raises 22P02. */
function pgBoolean(text: string | null): boolean | null {
  if (text === null) return null;
  const t = text.trim().toLowerCase();
  if (PG_TRUE.has(t)) return true;
  if (PG_FALSE.has(t)) return false;
  throw new DbError("22P02", `invalid input syntax for type boolean: "${text}"`);
}

/** `array @> to_jsonb(ARRAY[text])`: the array holds this text as a string (or null). */
function containsText(array: Json[], text: string | null): boolean {
  return array.some((element) => (text === null ? element === null : element === text));
}

function objectAt(settings: JsonObject, key: string): JsonObject {
  const value = settings[key];
  return isObject(value) ? value : {};
}

function arrayAt(settings: JsonObject, key: string, fallback: Json[] = []): Json[] {
  const value = settings[key];
  return Array.isArray(value) ? value : fallback;
}

function numberOr0(text: string | null): number {
  return text === null ? 0 : pgNumeric(text);
}

/** Postgres prints numerics without a trailing ".0". */
function formatNumeric(n: number): string {
  return String(n);
}

function regression(message: string): DbError {
  return new DbError("23514", `user_settings regression: ${message}`);
}

/**
 * Onboarding one-shot dismissal flags (038 predicate 4). Keep in step with
 * OnboardingFlags in lib/settings/persistence.ts, as the trigger was.
 */
export const ONBOARDING_ONE_SHOT_FLAGS = [
  "firstVisitOnboardingDismissed",
  "welcomeDismissed",
  "practiceHintDismissed",
  "statsHintDismissed",
  "settingsHintDismissed",
  "installNudgeDismissed",
  "audioHintDismissed",
  "cardTypesHintDismissed",
  "guestStorageNoticeDismissed",
  "journeyMasteryExplainerDismissed",
  "markWhatIKnowNudgeDismissed",
  "practiceScopeNudgeDismissed",
  "scopeEverOpened",
  "offlineDownloadNudgeDismissed",
  "pastureLongPressHintDismissed",
  "higherOrLowerNudgeDismissed",
  "guestSignUpNudgeDismissed",
] as const;

/** Top-level one-shot flags (038 predicate 5); never bypassed by onboardingResetAt. */
export const TOP_LEVEL_ONE_SHOT_FLAGS = ["typedEntryOnboardingShown", "mcCardOnboardingShown"] as const;

/** Onboarding counters that may not decrease (038 predicate 6). */
export const ONBOARDING_MONOTONIC_COUNTERS = ["practiceSessionsCount", "slowSpriteLoadCount"] as const;

/**
 * public.user_settings_reject_regression (038), predicate for predicate, with
 * the same messages and code 23514. Throws on the first predicate that fails.
 */
export function assertNoSettingsRegression(oldSettings: Json, newSettings: Json): void {
  const OLD: JsonObject = isObject(oldSettings) ? oldSettings : {};
  const NEW: JsonObject = isObject(newSettings) ? newSettings : {};

  // 1 + 2: streakProtection.
  const oldSp = objectAt(OLD, "streakProtection");
  const newSp = objectAt(NEW, "streakProtection");
  const oldSpend = arrayAt(oldSp, "spendDates");
  const newSpend = arrayAt(newSp, "spendDates");
  for (const element of oldSpend) {
    const date = pgText(element);
    if (!containsText(newSpend, date)) {
      throw regression(`spendDate ${date ?? ""} removed from streakProtection`);
    }
  }
  const oldBal = numberOr0(pgText(oldSp.balance));
  const newBal = numberOr0(pgText(newSp.balance));
  if (newBal < oldBal && newSpend.length <= oldSpend.length) {
    throw regression(
      `streakProtection.balance dropped (${formatNumeric(oldBal)} -> ${formatNumeric(newBal)}) without new spendDate`,
    );
  }

  // 3: earnedBadges ids.
  const oldBadges = arrayAt(OLD, "earnedBadges");
  const newBadges = arrayAt(NEW, "earnedBadges");
  for (const badge of oldBadges) {
    const id = isObject(badge) ? pgText(badge.id) : null;
    if (id === null) continue;
    if (!newBadges.some((b) => isObject(b) && pgText(b.id) === id)) {
      throw regression(`earnedBadge id ${id} removed`);
    }
  }

  // 4: onboarding dismissal flags, unless a strictly newer onboardingResetAt.
  const oldOnb = objectAt(OLD, "onboarding");
  const newOnb = objectAt(NEW, "onboarding");
  const newResetAt = pgText(NEW.onboardingResetAt);
  const intentionalReset = newResetAt !== null && newResetAt > (pgText(OLD.onboardingResetAt) ?? "");
  if (!intentionalReset) {
    for (const flag of ONBOARDING_ONE_SHOT_FLAGS) {
      if (pgBoolean(pgText(oldOnb[flag])) === true && pgBoolean(pgText(newOnb[flag])) !== true) {
        throw regression(`onboarding.${flag} was true, cannot be set to non-true`);
      }
    }
  }

  // 5: top-level one-shot flags.
  for (const flag of TOP_LEVEL_ONE_SHOT_FLAGS) {
    if (pgBoolean(pgText(OLD[flag])) === true && pgBoolean(pgText(NEW[flag])) !== true) {
      throw regression(`top-level flag ${flag} was true, cannot be set to non-true`);
    }
  }

  // 6: onboarding counters, with the same reset exception as 4.
  if (!intentionalReset) {
    for (const counter of ONBOARDING_MONOTONIC_COUNTERS) {
      const oldCount = numberOr0(pgText(oldOnb[counter]));
      const newCount = numberOr0(pgText(newOnb[counter]));
      if (newCount < oldCount) {
        throw regression(
          `onboarding.${counter} decreased (${formatNumeric(oldCount)} -> ${formatNumeric(newCount)})`,
        );
      }
    }
  }

  // 7: learningLocales: a locale leaves only with a removedLocales tombstone.
  const oldLl = arrayAt(OLD, "learningLocales", ["en"]);
  const newLl = arrayAt(NEW, "learningLocales", ["en"]);
  const newRemoved = arrayAt(NEW, "removedLocales");
  for (const element of oldLl) {
    const locale = pgText(element);
    if (!containsText(newLl, locale) && !containsText(newRemoved, locale)) {
      throw regression(`learningLocale ${locale ?? ""} removed without tombstone in removedLocales`);
    }
  }
}

/** The next updated_at: now, or 1 ms after the stored value if the clock is behind it. */
function nextTimestamp(previous: string | null): string {
  const now = Date.now();
  const prev = previous === null ? NaN : Date.parse(previous);
  return new Date(Number.isNaN(prev) ? now : Math.max(now, prev + 1)).toISOString();
}

/**
 * Inserts the row with `patch` as its settings, or deep-merges `patch` into
 * the stored settings after the 038 guard. A null patch is `{}`, as COALESCE
 * made it. Throws DbError: 23514 for a regression, 22P02 for a patch that is
 * not an object, 40001 after five lost races.
 */
export async function mergeUserSettings(
  db: D1DatabaseLike,
  userId: string,
  patch: Json | undefined,
): Promise<void> {
  if (patch !== null && patch !== undefined && !isObject(patch)) {
    throw new DbError("22P02", "merge_user_settings: p_patch must be a JSON object");
  }
  const patchObject: JsonObject = patch ?? {};
  try {
    for (let attempt = 0; attempt < MERGE_MAX_ATTEMPTS; attempt++) {
      const row = await db
        .prepare("SELECT settings, updated_at FROM user_settings WHERE user_id = ?")
        .bind(userId)
        .first<{ settings: string; updated_at: string }>();

      if (!row) {
        const inserted = await db
          .prepare(
            "INSERT INTO user_settings (user_id, settings, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING",
          )
          .bind(userId, JSON.stringify(patchObject), nextTimestamp(null))
          .run();
        if (inserted.meta.changes === 1) return;
        continue; // Another request created the row first: merge into it.
      }

      const stored = JSON.parse(row.settings) as Json;
      const merged = jsonDeepMerge(stored, patchObject);
      assertNoSettingsRegression(stored, merged);
      const updated = await db
        .prepare("UPDATE user_settings SET settings = ?, updated_at = ? WHERE user_id = ? AND updated_at = ?")
        .bind(JSON.stringify(merged), nextTimestamp(row.updated_at), userId, row.updated_at)
        .run();
      if (updated.meta.changes === 1) return;
    }
  } catch (err) {
    throw toDbError(err);
  }
  throw new DbError("40001", "merge_user_settings: the settings row kept changing, retry shortly");
}
