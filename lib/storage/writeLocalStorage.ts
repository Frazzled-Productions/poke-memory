/**
 * Shared localStorage write-with-guard utility.
 *
 * Encapsulates the repeated pattern across persistence modules:
 *
 *   if (typeof window === 'undefined') return;
 *   try {
 *     window.localStorage.setItem(key, JSON.stringify(value));
 *   } catch { /* swallow quota / security errors *\/ }
 *
 * Options:
 *   notify — when true, dispatches a synthetic StorageEvent on window after a
 *             successful write so same-tab `window.addEventListener('storage', …)`
 *             listeners re-read the value without waiting for a cross-tab event
 *             (the browser only fires the native event in *other* tabs).
 *             The event carries `key` and `newValue` set to the serialised JSON
 *             string, matching the native StorageEvent shape.
 *
 * Notes:
 *   - The value is serialised with `JSON.stringify`. Pass a string directly
 *     if you need to store a raw (non-JSON) string — it will be double-encoded
 *     (`'"hello"'`). Use `writeLocalStorageRaw` for that case.
 *   - Errors from `JSON.stringify`, `setItem`, and `StorageEvent` dispatch are
 *     all swallowed. Write failures are always best-effort for localStorage.
 *   - StorageEvent dispatch is the *simple* convention (key + newValue). Sites
 *     that dispatch additional CustomEvents (e.g. SETTINGS_SAVED_EVENT,
 *     SESSION_CHANGED_EVENT) or re-read the value from storage keep their own
 *     dispatch logic alongside a plain `writeLocalStorage` call.
 */
export type WriteLocalStorageOptions = {
  /** Dispatch a synthetic StorageEvent after a successful write. Defaults to false. */
  notify?: boolean;
};

/**
 * Serialise `value` with `JSON.stringify` and store it at `key`.
 *
 * No-op on the server (SSR). Swallows all write errors.
 */
export function writeLocalStorage<T>(
  key: string,
  value: T,
  options: WriteLocalStorageOptions = {},
): void {
  if (typeof window === "undefined") return;
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return;
  }
  try {
    window.localStorage.setItem(key, serialised);
  } catch {
    // QuotaExceededError, SecurityError, or similar — best-effort.
    return;
  }
  if (options.notify) {
    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          storageArea: window.localStorage,
          newValue: serialised,
        }),
      );
    } catch {
      // Older browsers / non-standard environments without a StorageEvent constructor.
    }
  }
}

/**
 * Store a raw string at `key` without any JSON serialisation.
 *
 * Use this for values that are already plain strings (e.g. a UUID or a
 * version string) and must NOT be double-encoded as JSON.
 *
 * No-op on the server (SSR). Swallows all write errors.
 */
export function writeLocalStorageRaw(
  key: string,
  value: string,
  options: WriteLocalStorageOptions = {},
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // QuotaExceededError, SecurityError, or similar — best-effort.
    return;
  }
  if (options.notify) {
    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          storageArea: window.localStorage,
          newValue: value,
        }),
      );
    } catch {
      // Older browsers / non-standard environments without a StorageEvent constructor.
    }
  }
}
