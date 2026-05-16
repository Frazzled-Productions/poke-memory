let audioEl: HTMLAudioElement | null = null;
let pendingEndedListener: (() => void) | null = null;

/**
 * Returns a Promise that resolves when the currently-playing cry finishes.
 *
 * Resolves immediately when:
 *   - No audio element has ever been created (`audioEl` is null).
 *   - The element is paused (playback has not started, or has already ended).
 *
 * Otherwise, the Promise resolves on the next `ended` or `error` event.
 * A 5-second fallback timer guarantees resolution even if the event never
 * fires (e.g. a decoding stall) — so the card transition cannot hang forever.
 */
export function awaitCryEnd(): Promise<void> {
  if (audioEl === null || audioEl.paused) return Promise.resolve();

  const captured = audioEl;

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    // Resolve on natural completion or on error (audio won't advance further).
    captured.addEventListener("ended", finish, { once: true });
    captured.addEventListener("error", finish, { once: true });
    // Safety net: never block the transition longer than 5 s.
    const timer = setTimeout(() => {
      captured.removeEventListener("ended", finish);
      captured.removeEventListener("error", finish);
      finish();
    }, 5_000);
  });
}

/**
 * Play a Pokémon cry, optionally chaining a callback to fire after the cry finishes.
 *
 * `onEnded` fires:
 *   - after the audio's `ended` event (natural completion), or
 *   - immediately if there's nothing to play (null url / no audio support), or
 *   - immediately if `play()` rejects with NotAllowedError (autoplay blocked).
 *
 * It does NOT fire when a new `playCry` call interrupts an in-flight cry — the
 * prior call is dropped in favour of the latest one, which sets up its own listener.
 */
export function playCry(url: string | null, volume = 0.6, onEnded?: () => void): void {
  // Drop any prior chained callback so a rapid second call doesn't double-fire.
  if (audioEl !== null && pendingEndedListener !== null) {
    audioEl.removeEventListener("ended", pendingEndedListener);
    pendingEndedListener = null;
  }

  if (url === null || typeof window === "undefined") {
    onEnded?.();
    return;
  }

  if (audioEl === null) audioEl = new Audio();
  audioEl.pause();
  audioEl.src = url;
  audioEl.volume = volume;
  audioEl.currentTime = 0;
  audioEl.loop = false;

  if (onEnded !== undefined) {
    const listener = () => {
      audioEl?.removeEventListener("ended", listener);
      if (pendingEndedListener === listener) pendingEndedListener = null;
      onEnded();
    };
    pendingEndedListener = listener;
    audioEl.addEventListener("ended", listener);
  }

  audioEl.play().catch((err: unknown) => {
    if (err instanceof Error && err.name === "AbortError") return;
    if (err instanceof Error && err.name !== "NotAllowedError") {
      console.error("[cry] play failed:", err);
    }
    // Cry didn't actually start — fire the chained callback so TTS still happens.
    if (onEnded !== undefined && pendingEndedListener !== null) {
      audioEl?.removeEventListener("ended", pendingEndedListener);
      pendingEndedListener = null;
      onEnded();
    }
  });
}
