import type { UserSettings } from "./persistence";

/**
 * Tracks the settings object this device last successfully pushed to cloud,
 * so `AutoSyncOnChange.handleSettings` can compute a top-level-key diff and
 * send only the keys that actually changed. Without this, every settings
 * save pushes the whole JSONB blob and `merge_user_settings`'s `||` overlay
 * silently last-write-wins every key — meaning a device that has slightly
 * stale settings would clobber another device's per-field changes on the
 * next unrelated save (#583).
 *
 * Stored under `poke-memory:settings:*` so `clearLocalProgress` preserves it
 * (the snapshot is a sync-tracking concern, not user progress). If the
 * snapshot is missing / corrupted, the diff falls back to "everything" and
 * the next push behaves the same as before this change — safe regression
 * floor.
 */

const KEY = "poke-memory:settings:last-pushed:v1";

export function loadLastPushedSettings(): UserSettings | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as UserSettings;
  } catch {
    return null;
  }
}

export function saveLastPushedSettings(settings: UserSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // QuotaExceededError or similar — snapshot write is best-effort.
  }
}

// Keys that are device-local and must never be pushed to cloud.
// appVisitCount is guarded by sessionStorage — it increments once per device
// session and is only meaningful on the device that recorded it. Syncing it
// would inflate the PWA nudge threshold on other devices.
const DEVICE_LOCAL_KEYS: ReadonlySet<keyof UserSettings> = new Set<keyof UserSettings>(["appVisitCount"]);

/**
 * Shallow top-level key diff. Two reasons we stop at the top level:
 *   1. `merge_user_settings`'s `||` JSONB overlay merges at the same depth,
 *      so a deeper diff would be wasted precision.
 *   2. Settings sub-objects (onboarding, practiceScope, favouriteTheme,
 *      earnedBadges) are written atomically by their UI code — the consumer
 *      always replaces the whole sub-object, not individual keys inside it.
 *
 * Returns the full `next` (minus device-local keys) when `prev` is null
 * (first push from this device). Otherwise returns an object containing only
 * the top-level keys whose JSON-serialised value differs, again excluding
 * device-local keys.
 */
export function diffSettings(
  prev: UserSettings | null,
  next: UserSettings,
): Partial<UserSettings> {
  if (prev === null) {
    const { appVisitCount: _local, ...cloudSettings } = next;
    return cloudSettings;
  }
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof UserSettings>) {
    if (DEVICE_LOCAL_KEYS.has(key)) continue;
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      patch[key as string] = next[key];
    }
  }
  return patch as Partial<UserSettings>;
}
