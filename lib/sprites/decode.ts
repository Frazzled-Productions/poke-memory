/**
 * Default safety-valve timeout for sprite decode. If any sprite is slow
 * (e.g. a cold CDN edge), we let the caller proceed anyway so the UI is never
 * stuck. Sprites are self-hosted static assets, so in practice decode
 * completes well under 100 ms after the first visit.
 */
export const DECODE_TIMEOUT_MS = 500;

/**
 * Tighter ceiling used on the grade critical path (#1191). The swap should
 * be bounded even on a cold sprite — 150 ms is enough to eliminate visible
 * pop-in on already-warmed assets while not noticeably delaying the swap.
 */
export const DECODE_GRADE_TIMEOUT_MS = 150;

/**
 * Decode a list of sprite URLs via `HTMLImageElement.decode()` so the browser
 * fully fetches and decodes each image before the caller swaps visible state.
 *
 * This prevents the brief sprite pop-in that occurs when React advances to the
 * next card synchronously but the browser still needs to decode the image bytes
 * that were warmed into the network cache by `SpritePreloader`. A warmed fetch
 * is not a warmed decode — this call bridges that gap.
 *
 * A combined `Promise.race` with a timeout acts as a safety valve: if any
 * image is unexpectedly slow the UI advances anyway rather than blocking
 * indefinitely.
 *
 * @param urls - Sprite URLs to decode. Empty arrays resolve immediately.
 * @param timeoutMs - Safety-valve ceiling in milliseconds. Defaults to
 *   {@link DECODE_TIMEOUT_MS} (500 ms). Pass {@link DECODE_GRADE_TIMEOUT_MS}
 *   (150 ms) on the grade critical path where speed is the priority.
 * @param onSlowLoad - Optional callback invoked when the timeout wins the race,
 *   indicating a slow sprite load. Used by the grade critical path in
 *   `ReviewSession` to increment `slowSpriteLoadCount` for the offline-download
 *   nudge (#1538). Not called when `urls` is empty (no decode attempted).
 */
export async function decodeSpriteUrls(
  urls: readonly string[],
  timeoutMs = DECODE_TIMEOUT_MS,
  onSlowLoad?: () => void,
): Promise<void> {
  if (urls.length === 0) return;
  const decodes = urls.map((url) => {
    const img = new window.Image();
    img.src = url;
    // `decode()` is a modern browser API; it may be absent in test environments
    // (jsdom) or very old browsers. Fall back gracefully — the swap proceeds
    // immediately rather than blocking.
    if (typeof img.decode !== "function") return Promise.resolve();
    return img.decode().catch(() => {
      // Ignore per-image failures — better to show the next card with a brief
      // pop-in than to block the swap indefinitely.
    });
  });

  let timedOut = false;
  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs),
  );

  await Promise.race([Promise.all(decodes), timeoutPromise]);

  if (timedOut) {
    onSlowLoad?.();
  }
}
