/**
 * Background Sync registration helper (#1054).
 *
 * Progressive enhancement: Background Sync is a Chromium-only API. On
 * unsupported browsers (Firefox, Safari) this module is a no-op and the
 * existing on-reconnect replay path (`useOnlineReconnectSync`) continues to
 * handle the catch-up.
 *
 * When a grade push fails while offline, the caller registers the
 * `poke-memory:grade-sync` tag. The browser will fire a `sync` event in the
 * service worker once connectivity is restored — even if every app tab is
 * closed. The SW handler (`app/sw.ts`) then reads the persisted pending queue
 * from IndexedDB and replays it against `/api/sync`.
 *
 * Anti-double-push: the SW checks for active window clients before pushing.
 * If at least one client is visible, the SW posts `BACKGROUND_SYNC_REPLAY`
 * and the already-mounted `useOnlineReconnectSync` handles the push. If no
 * clients are present, the SW pushes directly. In either path the upsert is
 * idempotent (`ON CONFLICT DO UPDATE` on `(user_id, card_type, subject_key)`),
 * so a rare concurrent push (e.g. the tab opens in the same instant the SW
 * sync fires) is safe.
 */

/** The sync tag registered with the browser's SyncManager. */
export const BACKGROUND_SYNC_TAG = "poke-memory:grade-sync";

/**
 * Message type posted from the service worker to active window clients when
 * the `sync` event fires while a tab is open. The client-side
 * `useOnlineReconnectSync` listens for this message and handles the push so
 * the SW does not push in parallel with the running app.
 */
export const SW_REPLAY_MESSAGE = "BACKGROUND_SYNC_REPLAY";

/**
 * Returns true when the Background Sync API is available in this browser.
 * Chromium on Android supports it; Firefox and Safari do not.
 */
export function isBackgroundSyncSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "SyncManager" in window
  );
}

/**
 * Registers the grade-sync Background Sync tag with the browser.
 *
 * Call this after a grade push fails (offline or server error) so the browser
 * will replay the persisted queue when connectivity returns, even if the app
 * is closed at that point.
 *
 * No-op when Background Sync is not supported or the service worker is not
 * registered. Never throws — any error is swallowed and logged.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (!isBackgroundSyncSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    // The SyncManager type is not in the standard TypeScript lib; guard with an
    // explicit property check so this compiles without a cast.
    const syncManager = (registration as unknown as { sync?: { register(tag: string): Promise<void> } }).sync;
    if (!syncManager) return;
    await syncManager.register(BACKGROUND_SYNC_TAG);
  } catch (err) {
    // The browser may reject the registration (e.g. user denied notifications
    // permission, or the SW is not yet installed). Silently degrade — the
    // on-reconnect-while-open path remains the fallback.
    console.warn("[background-sync] failed to register sync tag:", err);
  }
}
