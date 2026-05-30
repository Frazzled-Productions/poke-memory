import { KEY_LAST_SEEN_VERSION } from "@/lib/storage/keys";
import { readLocalStorage } from "@/lib/storage/readLocalStorage";
import { writeLocalStorageRaw } from "@/lib/storage/writeLocalStorage";

export const LAST_SEEN_VERSION_KEY = KEY_LAST_SEEN_VERSION;

export function readLastSeenVersion(): string | null {
  // The stored value is a raw version string (not JSON-encoded), so the parse
  // callback returns the raw string directly.
  return readLocalStorage(LAST_SEEN_VERSION_KEY, (raw) => raw, null);
}

export function writeLastSeenVersion(version: string): void {
  // The version string is stored raw (not JSON-encoded) and a StorageEvent
  // is dispatched so same-tab listeners (nav dot) re-read immediately.
  // writeLocalStorageRaw with notify:true reproduces this exactly.
  writeLocalStorageRaw(LAST_SEEN_VERSION_KEY, version, { notify: true });
}
