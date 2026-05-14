import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings } from "@/lib/settings/persistence";
import type { DateFormat } from "@/lib/utils/format-date";
import type { MergeUserSettingsArgs } from "@/lib/supabase/rpc-types";

type MergeUserSettingsArgsPatch = Omit<MergeUserSettingsArgs, "p_patch"> & {
  p_patch: Partial<UserSettings>;
};

// Settings sync is best-effort. pushSettings routes through the
// merge_user_settings RPC (migration 011/014), which atomically merges a JSONB
// patch via INSERT … ON CONFLICT DO UPDATE SET settings = settings || patch.
// That eliminates the last-write-wins race window two concurrent devices could
// otherwise open by overwriting the whole settings column. pushRegionalPrefs
// remains a separate scalar-column write path (see comment below).

// Generated Supabase types do not yet include merge_user_settings. Cast the
// call site through `unknown` to a narrow signature so name + args stay typed.
// Keep the cast on the *call expression* (not a separate const) so the JS
// member-access reference is preserved and `this` binds to `client` — extracting
// to a local would strip `this` and SupabaseClient.rpc reads `this.rest`.
type MergeUserSettingsRpc = (
  name: "merge_user_settings",
  args: MergeUserSettingsArgsPatch,
) => Promise<{ error: PostgrestError | null }>;

/**
 * Push a JSONB patch to the user's settings row via merge_user_settings.
 * Accepts `Partial<UserSettings>` so callers can send only the keys they
 * intend to change — the RPC's `||` overlay only touches keys present in
 * the patch, leaving the rest of cloud's blob alone (#583). Callers may
 * still pass a full `UserSettings` object; it's a no-op widening.
 *
 * `AutoSyncOnChange.handleSettings` diffs against the last-pushed snapshot
 * (`lib/settings/lastPushedSnapshot`) and sends only changed top-level keys.
 * Other callers (sign-in, force-pull) intentionally push the full object.
 */
export async function pushSettings(
  client: SupabaseClient,
  userId: string,
  patch: Partial<UserSettings>,
): Promise<boolean> {
  try {
    const { error } = await (client.rpc as unknown as MergeUserSettingsRpc)(
      "merge_user_settings",
      { p_user_id: userId, p_patch: patch },
    );
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Regional preferences (timezone + date_format)
// ---------------------------------------------------------------------------
//
// These live in dedicated scalar columns on user_settings, NOT inside the
// JSONB `settings` blob. Reason: keep two independent write paths cleanly
// separated. pushSettings() routes through merge_user_settings, which patches
// the JSONB blob; pushRegionalPrefs() targets only these scalar columns. No
// merge ambiguity, no cross-path row creation risk. Even with the atomic merge
// in place, splitting them keeps the regional-prefs write narrow and means a
// device whose pushSettings has not yet run cannot accidentally null these.

export type RegionalPrefs = {
  timezone: string | null;
  dateFormat: DateFormat | null;
};

/**
 * Write timezone + date_format scalar columns to user_settings.
 * Kept separate from pushSettings() so the two write paths target disjoint
 * columns and never compete for the same row. The two are safe to execute
 * concurrently.
 */
export async function pushRegionalPrefs(
  client: SupabaseClient,
  userId: string,
  prefs: RegionalPrefs,
): Promise<boolean> {
  try {
    // UPDATE rather than upsert — avoids creating a sparse row (settings=NULL)
    // for a user whose pushSettings hasn't run yet. A no-op update (row doesn't
    // exist) is safe: the row will be created by pushSettings and the next
    // explicit timezone/date_format change will update the scalar columns.
    const { error } = await client
      .from("user_settings")
      .update({
        timezone: prefs.timezone,
        date_format: prefs.dateFormat,
      })
      .eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Pull timezone + date_format scalar columns from user_settings.
 * Returns null if the user has no row, or if both columns are null.
 */
export async function pullRegionalPrefs(
  client: SupabaseClient,
  userId: string,
): Promise<RegionalPrefs | null> {
  try {
    const { data, error } = await client
      .from("user_settings")
      .select("timezone, date_format")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { timezone: string | null; date_format: string | null };
    const dateFormat = validateDateFormat(row.date_format);
    if (row.timezone === null && dateFormat === null) return null;
    return { timezone: row.timezone, dateFormat };
  } catch {
    return null;
  }
}

function validateDateFormat(value: string | null): DateFormat | null {
  if (value === "iso" || value === "dmy" || value === "mdy") return value;
  return null;
}

// ---------------------------------------------------------------------------
// JSONB settings blob (original push/pull — unchanged)
// ---------------------------------------------------------------------------

// Returns the cloud settings object, or null if the user has no row yet, the
// row's settings column is null or empty ({}), or the fetch failed. Both null
// and {} are treated as "no cloud settings" so a sparse row created by
// pushRegionalPrefs (which does not write to the settings column) or a
// default-only scaffolding row does not overwrite real local choices.
export async function pullSettings(
  client: SupabaseClient,
  userId: string,
): Promise<UserSettings | null> {
  const result = await pullSettingsWithTimestamp(client, userId);
  return result === null ? null : result.settings;
}

export type PulledSettings = {
  settings: UserSettings;
  /** Server-side updated_at — the cross-device anchor for "is cloud newer than what this device last saw". Null if the row has no timestamp (legacy). */
  updatedAt: string | null;
};

/**
 * Same shape as `pullSettings` but also returns `user_settings.updated_at`.
 * Lets the background pull decide whether the cloud copy is newer than the
 * last copy this device applied. Without it, a device that has any local
 * settings can never receive remote updates (issue #572).
 *
 * Returns `null` when the row has no real settings — same semantics as
 * `pullSettings`. Callers that *also* need the row's `last_reset_at` should
 * use `pullUserSettingsRow` directly, because that flag is meaningful even
 * when the JSONB blob is empty (reset_all_progress creates a row with only
 * `last_reset_at` populated — see migration 022).
 */
export async function pullSettingsWithTimestamp(
  client: SupabaseClient,
  userId: string,
): Promise<PulledSettings | null> {
  const row = await pullUserSettingsRow(client, userId);
  if (row === null || row.settings === null) return null;
  return { settings: row.settings, updatedAt: row.updatedAt };
}

export type UserSettingsRow = {
  /** JSONB settings blob, null when missing or empty `{}`. */
  settings: UserSettings | null;
  /** Server-side updated_at, null on legacy rows or schema drift. */
  updatedAt: string | null;
  /** ISO timestamp of the user's last `reset_all_progress` call. Null = no reset on record. See migration 022 / issue #576. */
  lastResetAt: string | null;
};

/**
 * Single-query helper that returns every column of the `user_settings` row the
 * sync layer cares about. Callers that only want the JSONB blob should use
 * `pullSettings` / `pullSettingsWithTimestamp`; the background pull uses this
 * directly so it can read `last_reset_at` (the tombstone marker — issue #576)
 * even when the JSONB column is empty.
 *
 * Returns `null` only when the row doesn't exist or the fetch failed.
 */
export async function pullUserSettingsRow(
  client: SupabaseClient,
  userId: string,
): Promise<UserSettingsRow | null> {
  try {
    const { data, error } = await client
      .from("user_settings")
      .select("settings, updated_at, last_reset_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    // updated_at + last_reset_at are typed string | undefined because the
    // actual failure mode this layer guards against is schema drift / missing
    // keys in the response, not a NULL column value. The `?? null` coercion
    // normalises to null for safe ISO-string comparisons downstream.
    const row = data as {
      settings: unknown;
      updated_at: string | undefined;
      last_reset_at: string | undefined;
    };
    const validSettings =
      typeof row.settings === "object" &&
      row.settings !== null &&
      Object.keys(row.settings as Record<string, unknown>).length > 0;
    return {
      settings: validSettings ? (row.settings as UserSettings) : null,
      updatedAt: row.updated_at ?? null,
      lastResetAt: row.last_reset_at ?? null,
    };
  } catch {
    return null;
  }
}
