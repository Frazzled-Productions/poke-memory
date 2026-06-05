import { KEY_CLIENT_SALT } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorageRaw } from "@/lib/storage/writeLocalStorage";

/**
 * Returns a stable per-device salt for use in `stableShuffleForDay`.
 *
 * On first call the salt is generated with `crypto.randomUUID()` and
 * persisted to localStorage under `KEY_CLIENT_SALT` so subsequent page
 * loads return the same value.  If localStorage is unavailable (e.g. in a
 * Node test environment) a fallback empty string is returned - the shuffle
 * still works, just without per-device differentiation.
 *
 * Authenticated users should use their Supabase `user.id` instead of this
 * value; this helper is intended for the guest path only.
 */
export function getOrCreateClientSalt(): string {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return "";
  }
  // The salt is stored as a raw string (not JSON-encoded), so we pass the raw
  // value through directly without JSON.parse.
  const existing = readLocalStorage(KEY_CLIENT_SALT, (raw) => raw, null);
  if (existing !== null) {
    return existing;
  }
  const fresh = crypto.randomUUID();
  // writeLocalStorageRaw swallows quota / privacy-mode errors; if the write
  // fails the generated value is returned for this session only and won't persist.
  writeLocalStorageRaw(KEY_CLIENT_SALT, fresh);
  return fresh;
}
