/**
 * Byte-count formatting helpers.
 *
 * Single source of truth for human-readable byte size display so callers
 * do not inline the arithmetic at multiple sites (#1788).
 */

/**
 * Format a byte count as GB, rounded to one decimal place.
 *
 * Use for storage quota and usage figures ("Using X of Y available"), which
 * are genuinely GB-scale (device quota is typically 64 GB or larger). GB with
 * one decimal place gives the right precision for that context.
 *
 * Do NOT use for download-progress bytes - those are at most a few hundred MB
 * and GB-with-one-decimal rounds too coarsely (0.0 GB for the first 50 MB).
 * Use {@link formatDownloadBytes} for download progress instead.
 *
 * @example
 *   formatGb(200_000_000)    // "0.2 GB"
 *   formatGb(64_000_000_000) // "64.0 GB"
 *   formatGb(96_000_000)     // "0.1 GB"
 */
export function formatGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * Format a download-progress byte count at MB scale, switching to GB once the
 * value reaches 1,000 MB (1 GB).
 *
 * Download progress bytes (`bytesSoFar` from `lib/pwa/precache.ts`) are at most
 * a few hundred MB for the offline sprite+cry pack. GB-with-one-decimal (the
 * {@link formatGb} form) rounds to "0.0 GB" for the first 50 MB of a run and
 * only steps in 0.1 GB (100 MB) increments, making it useless for showing
 * meaningful progress. This formatter shows "60.0 MB" during the download and
 * switches to "1.2 GB" only if the total genuinely exceeds a gigabyte.
 *
 * Note: `bytesSoFar` is the sum of `Content-Length` header values (or
 * response blob-size fallback) for URLs freshly fetched and stored during this
 * download run. It reflects the download's own bytes - NOT
 * `navigator.storage.estimate().usage`, which is an estimate of all origin
 * data in the browser. The two figures are shown near each other in
 * OfflineSection but measure different things.
 *
 * @example
 *   formatDownloadBytes(60_000_000)   // "60.0 MB"
 *   formatDownloadBytes(166_000_000)  // "166.0 MB"
 *   formatDownloadBytes(1_200_000_000) // "1.2 GB"
 */
export function formatDownloadBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
