import type { UserSettings } from "./persistence";
import { KEY_SETTINGS_LAST_PUSHED } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorage } from "@/lib/storage/writeLocalStorage";

/**
 * Tracks the settings object this device last successfully pushed to cloud,
 * so `AutoSyncOnChange.handleSettings` can compute a top-level-key diff and
 * send only the keys that actually changed. Without this, every settings
 * save pushes the whole JSONB blob and `merge_user_settings`'s `||` overlay
 * silently last-write-wins every key - meaning a device that has slightly
 * stale settings would clobber another device's per-field changes on the
 * next unrelated save (#583).
 *
 * Stored under `poke-memory:settings:*` so `clearLocalProgress` preserves it
 * (the snapshot is a sync-tracking concern, not user progress). If the
 * snapshot is missing / corrupted, the diff falls back to "everything" and
 * the next push behaves the same as before this change - safe regression
 * floor.
 */

const KEY = KEY_SETTINGS_LAST_PUSHED;

export function loadLastPushedSettings(): UserSettings | null {
  return readLocalStorage(KEY, (raw) => JSON.parse(raw) as UserSettings, null);
}

export function saveLastPushedSettings(settings: UserSettings): void {
  writeLocalStorage(KEY, settings);
}

// Keys that are device-local and must never cross the sync boundary in either
// direction. appVisitCount is guarded by sessionStorage - it increments once
// per device session and is only meaningful on the device that recorded it.
// Syncing it would inflate the PWA nudge threshold on other devices.
// activePokemonNameLocale is the per-device active selection from the enrolled
// learning set (#1568) - each device tracks its own active language independently;
// syncing it would clobber deliberate per-device choices (e.g. practising
// Japanese on a phone while using Chinese on a tablet).
export const DEVICE_LOCAL_KEYS: ReadonlySet<keyof UserSettings> =
  new Set<keyof UserSettings>(["appVisitCount", "activePokemonNameLocale"]);

/**
 * Returns `cloud` with each device-local key overwritten by the local value,
 * so a pulled cloud blob can never clobber a device-local counter. Used on the
 * pull side as the symmetric partner to the `diffSettings` push-side exclusion.
 */
export function preserveDeviceLocalKeys(
  cloud: UserSettings,
  local: UserSettings,
): UserSettings {
  const result = { ...cloud };
  for (const key of DEVICE_LOCAL_KEYS) {
    (result as Record<string, unknown>)[key] = local[key];
  }
  return result;
}

/**
 * Shallow top-level key diff. Two reasons we stop at the top level:
 *   1. `merge_user_settings`'s `||` JSONB overlay merges at the same depth,
 *      so a deeper diff would be wasted precision.
 *   2. Settings sub-objects (onboarding, practiceScope, favouriteTheme,
 *      earnedBadges) are written atomically by their UI code - the consumer
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
  const patch: Record<string, unknown> = {};
  if (prev === null) {
    for (const key of Object.keys(next) as Array<keyof UserSettings>) {
      if (DEVICE_LOCAL_KEYS.has(key)) continue;
      patch[key as string] = next[key];
    }
    return patch as Partial<UserSettings>;
  }
  for (const key of Object.keys(next) as Array<keyof UserSettings>) {
    if (DEVICE_LOCAL_KEYS.has(key)) continue;
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      patch[key as string] = next[key];
    }
  }
  return patch as Partial<UserSettings>;
}
