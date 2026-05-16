import { awaitCryEnd } from "./cry";
import { awaitTtsEnd } from "./tts";

/**
 * Wait for any in-progress cry or TTS playback to finish before advancing
 * to the next card in the review session.
 *
 * When both audio features are on, playback is CHAINED: the cry plays first,
 * and TTS starts only when the cry's `ended` event fires (via the
 * `speakAfterCry` callback inside `playCry`). Awaiting them concurrently with
 * `Promise.all` would settle the moment the cry ends — exactly when TTS
 * begins — so the two are awaited SEQUENTIALLY instead:
 *
 *   1. `await awaitCryEnd()` — blocks until the cry's `ended` event fires.
 *      Because `awaitCryEnd` registers its listener *after* `playCry`'s
 *      `onEnded` listener, the event fires `onEnded` (starts TTS) before
 *      resolving this promise.
 *   2. Yield a macrotask tick so that any TTS started inside a `setTimeout(0)`
 *      (the Web Speech API path in `speakNameViaSpeech`) has been queued.
 *   3. `await awaitTtsEnd()` — blocks until TTS finishes (or resolves
 *      immediately when TTS is not in use).
 *
 * This also handles the concurrent case (both already playing when graded)
 * and the audio-off case (both fast-resolve), so a single sequential flow
 * covers all combinations correctly.
 *
 * Each leg carries its own 5-second safety timeout, so the overall wait is
 * bounded to at most 10 seconds even if events never fire.
 */
export async function waitForAudio(): Promise<void> {
  await awaitCryEnd();
  // Yield one macrotask so TTS started via setTimeout(0) inside the cry's
  // onEnded callback (speakNameViaSpeech) has been queued before awaitTtsEnd
  // inspects the speechSynthesis state.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await awaitTtsEnd();
}
