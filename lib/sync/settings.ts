import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings } from "@/lib/settings/persistence";
import type { DateFormat } from "@/lib/utils/format-date";

// Settings sync is best-effort. pushSettings routes through the
// merge_user_settings RPC (migration 011/014), which atomically merges a JSONB
// patch via INSERT … ON CONFLICT DO UPDATE SET settings = settings || patch.
// That eliminates the last-write-wins race window two concurrent devices could
// otherwise open by overwriting the whole settings column. pushRegionalPrefs
// remains a separate scalar-column write path (see comment below).

type MergeUserSettingsArgs = { p_user_id: string; p_patch: UserSettings };

export async function pushSettings(
  client: SupabaseClient,
  userId: string,
  settings: UserSettings,
): Promise<boolean> {
  try {
    // Generated Supabase types do not yet include merge_user_settings. Cast
    // through `unknown` to a narrow signature so the name + args stay typed at
    // the call site. Same pattern as app/api/srs/optimize/route.ts.
    const rpc = client.rpc as unknown as (
      name: "merge_user_settings",
      args: MergeUserSettingsArgs,
    ) => Promise<{ error: PostgrestError | null }>;
    const { error } = await rpc("merge_user_settings", {
      p_user_id: userId,
      p_patch: settings,
    });
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
        updated_at: new Date().toISOString(),
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
  try {
    const { data, error } = await client
      .from("user_settings")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const s = (data as { settings: unknown }).settings;
    // Treat both null and {} as "no real cloud settings". A row with
    // settings = NULL can be created by pushRegionalPrefs before pushSettings
    // has run; {} is the default from migration scaffolding. Neither should
    // overwrite real local choices on a new device.
    if (typeof s !== "object" || s === null) return null;
    if (Object.keys(s as Record<string, unknown>).length === 0) return null;
    return s as UserSettings;
  } catch {
    return null;
  }
}
