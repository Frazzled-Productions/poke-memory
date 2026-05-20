import { KEY_CLIENT_SALT } from "@/lib/storage/keys";

/**
 * Returns a stable per-device salt for use in `stableShuffleForDay`.
 *
 * On first call the salt is generated with `crypto.randomUUID()` and
 * persisted to localStorage under `KEY_CLIENT_SALT` so subsequent page
 * loads return the same value.  If localStorage is unavailable (e.g. in a
 * Node test environment) a fallback empty string is returned — the shuffle
 * still works, just without per-device differentiation.
 *
 * Authenticated users should use their Supabase `user.id` instead of this
 * value; this helper is intended for the guest path only.
 */
export function getOrCreateClientSalt(): string {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return "";
  }
  const existing = localStorage.getItem(KEY_CLIENT_SALT);
  if (existing !== null) {
    return existing;
  }
  const fresh = crypto.randomUUID();
  try {
    localStorage.setItem(KEY_CLIENT_SALT, fresh);
  } catch {
    // localStorage write failed (quota or privacy mode) — return the
    // generated value for this session only; it won't persist.
  }
  return fresh;
}
