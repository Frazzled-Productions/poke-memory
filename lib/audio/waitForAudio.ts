import { awaitCryEnd } from "./cry";
import { awaitTtsEnd } from "./tts";

/**
 * Wait for any in-progress cry or TTS playback to finish before advancing
 * to the next card in the review session.
 *
 * When both a cry and a name reading are playing (or one has already started
 * and the other is queued), the Promise resolves only after BOTH complete —
 * i.e. after the last of the two finishes.
 *
 * Resolves immediately when no audio is active, so there is no added latency
 * when audio features are disabled.
 */
export async function waitForAudio(): Promise<void> {
  await Promise.all([awaitCryEnd(), awaitTtsEnd()]);
}
