// localStorage flag for the audio-only practice mode. Persisted per
// device so picking it back up on the same browser doesn't require
// re-toggling.
const STORAGE_KEY = "poke-memory:audio-mode:v1";

export function loadAudioMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAudioMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Acquire a screen wake lock so the device doesn't dim during an
 * audio-only session. Returns a sentinel that can be released via
 * `releaseWakeLock`. Returns `null` when the Wake Lock API is
 * unavailable (Safari < 16.4, older Firefox, server) — the session
 * still works, the screen just might dim.
 */
export async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === "undefined") return null;
  const wakeLock = (navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
  }).wakeLock;
  if (!wakeLock || typeof wakeLock.request !== "function") return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}

export async function releaseWakeLock(
  sentinel: WakeLockSentinel | null,
): Promise<void> {
  if (sentinel === null) return;
  try {
    await sentinel.release();
  } catch {
    // ignore
  }
}
