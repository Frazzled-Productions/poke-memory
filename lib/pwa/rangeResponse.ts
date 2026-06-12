/**
 * Build a Response for an offline-pack asset served from IndexedDB, honouring
 * an HTTP `Range` request when present (#1886).
 *
 * Why this exists: the SW's `idb-first` handler used to return every IDB blob
 * as a bare `200 OK`. That is fine for `<img>` sprites, but WebKit's `<audio>`
 * / `<video>` pipeline issues a `Range` request and refuses to start media
 * playback unless the server replies `206 Partial Content` with a matching
 * `Content-Range`. Given a plain `200` from the SW, the cry audio element
 * stalls in a loading-but-not-paused state - no sound plays, and the practice
 * grade path then blocks on `awaitCryEnd()`'s 5 s safety timeout. Honouring the
 * range here makes cries (served from the offline pack) play on WebKit.
 *
 * Scope: applied to every offline-pack asset. Sprites never send a `Range`
 * header, so they keep the 200 path unchanged; only media (cries) exercises the
 * 206 branch. `Accept-Ranges: bytes` is advertised on the 200 path too so the
 * browser knows ranged requests are supported.
 *
 * Range support is intentionally minimal: a single `bytes=` range (the only
 * form browsers send for media). A multi-range request, an unsatisfiable range,
 * or an unparseable header falls back to a full `200` response rather than
 * erroring - playback still works, just without the partial optimisation.
 */

interface ParsedRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range` header against a known total size.
 *
 * Supports the three single-range forms RFC 7233 allows:
 *   - `bytes=start-end`  explicit closed range
 *   - `bytes=start-`     open-ended (to end of resource)
 *   - `bytes=-suffix`    final `suffix` bytes
 *
 * Returns `null` for: a non-`bytes` unit, a multi-range header (contains a
 * comma), a syntactically invalid range, or a range that cannot be satisfied
 * against `totalSize` (start past the end). `end` is inclusive.
 */
export function parseRangeHeader(header: string, totalSize: number): ParsedRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return null;

  const [, rawStart, rawEnd] = match;

  // `bytes=-suffix` - the final `suffix` bytes.
  if (rawStart === "") {
    if (rawEnd === "") return null; // `bytes=-` is invalid.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    const start = Math.max(0, totalSize - suffix);
    return { start, end: totalSize - 1 };
  }

  const start = Number(rawStart);
  if (start >= totalSize) return null; // Start past the end - unsatisfiable.

  // `bytes=start-` - open-ended to the last byte.
  const end = rawEnd === "" ? totalSize - 1 : Math.min(Number(rawEnd), totalSize - 1);
  if (end < start) return null;

  return { start, end };
}

/**
 * Build the Response for an IDB-served asset, returning `206` with a sliced
 * body when the request carries a satisfiable single `Range`, else a full
 * `200`. Both responses advertise `Accept-Ranges: bytes`.
 */
export function buildOfflineAssetResponse(
  request: Request,
  blob: Blob,
  contentType: string,
): Response {
  const rangeHeader = request.headers.get("Range");

  if (rangeHeader !== null) {
    const parsed = parseRangeHeader(rangeHeader, blob.size);
    if (parsed !== null) {
      const slice = blob.slice(parsed.start, parsed.end + 1, contentType);
      return new Response(slice, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${parsed.start}-${parsed.end}/${blob.size}`,
          "Content-Length": String(parsed.end - parsed.start + 1),
          "Accept-Ranges": "bytes",
        },
      });
    }
  }

  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
      "Accept-Ranges": "bytes",
    },
  });
}
