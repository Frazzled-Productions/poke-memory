import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSettings } from "@/lib/settings/persistence";

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
