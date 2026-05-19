import { KEY_LAST_SEEN_VERSION } from "@/lib/storage/keys";

export const LAST_SEEN_VERSION_KEY = KEY_LAST_SEEN_VERSION;

export function readLastSeenVersion(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

export function writeLastSeenVersion(version: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
    // Synthetic StorageEvent so same-tab listeners (nav dot) re-read
    // immediately. Native StorageEvents only fire cross-tab.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LAST_SEEN_VERSION_KEY,
        newValue: version,
      }),
    );
  } catch {
    // localStorage may be unavailable (private mode, quota). Silent — the
    // nav dot will keep showing until the user can persist the marker.
  }
}
