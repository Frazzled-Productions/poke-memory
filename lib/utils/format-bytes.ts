/**
 * Byte-count formatting helpers.
 *
 * Single source of truth for human-readable byte size display so callers
 * do not inline the arithmetic at multiple sites (#1788).
 */

/**
 * Format a byte count as GB, rounded to one decimal place.
 *
 * Storage quota and usage are GB-scale figures; MB display is misleading for
 * available quota (reported as device storage, e.g. 64 GB) and inflated for
 * the download progress (heuristic was ~2.8× real). GB with one decimal place
 * (e.g. "0.2 GB of 64.0 GB") is the appropriate precision for both.
 *
 * @example
 *   formatGb(200_000_000)   // "0.2 GB"
 *   formatGb(64_000_000_000) // "64.0 GB"
 *   formatGb(96_000_000)    // "0.1 GB"
 */
export function formatGb(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
