import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings } from "@/lib/settings/persistence";
import type { DateFormat } from "@/lib/utils/format-date";

// Settings sync is best-effort and uses a simple last-write-wins policy on
// the whole UserSettings object. We do not attempt per-field merge — single
// user, light cross-device churn, the round trips are not worth the
// complexity. See issue #294 for the motivating use case (restore settings
// after logout/login on the same device).

export async function pushSettings(
  client: SupabaseClient,
  userId: string,
  settings: UserSettings,
): Promise<boolean> {
  try {
    const { error } = await client
      .from("user_settings")
      .upsert(
        {
          user_id: userId,
          settings,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
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
// JSONB `settings` blob. Reason: pushSettings() rewrites the whole JSONB
// column via a last-write-wins upsert. If timezone/date_format were fields
// in that blob, a sync push from another device that hasn't detected the user's
// preferences yet could clobber them. The separate scalar columns are written
// through a different UPDATE path, which is safe to do alongside any JSONB push.

export type RegionalPrefs = {
  timezone: string | null;
  dateFormat: DateFormat | null;
};

/**
 * Write timezone + date_format scalar columns to user_settings.
 * This is intentionally NOT merged into pushSettings() to avoid the JSONB LWW
 * race described in the #517 audit. The two write paths are independent and
 * safe to execute concurrently.
 */
export async function pushRegionalPrefs(
  client: SupabaseClient,
  userId: string,
  prefs: RegionalPrefs,
): Promise<boolean> {
  try {
    const { error } = await client
      .from("user_settings")
      .upsert(
        {
          user_id: userId,
          timezone: prefs.timezone,
          date_format: prefs.dateFormat,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
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
// row's settings column is empty ({}), or the fetch failed. An empty {} is
// treated as "no cloud settings" so a default-only row from a previous
// scaffolding write does not overwrite real local choices.
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
    if (typeof s !== "object" || s === null) return null;
    if (Object.keys(s as Record<string, unknown>).length === 0) return null;
    return s as UserSettings;
  } catch {
    return null;
  }
}
