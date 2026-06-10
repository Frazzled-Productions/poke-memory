/**
 * Predicate that decides whether a server-side error should be forwarded to
 * Sentry. Extracted from `instrumentation.ts::onRequestError` so it can be
 * unit-tested independently.
 *
 * Policy:
 * - Skip Next.js "expected" internal throws: `notFound()` and `redirect()`
 *   both throw special sentinel errors that the framework handles itself.
 *   Capturing these would flood Sentry with operational noise that is never
 *   a real bug (e.g. every call to `notFound()` from an API route that
 *   validates its inputs).
 * - Capture everything else (genuine unhandled exceptions, uncaught throws
 *   in Server Components, Server Actions, and Route Handlers).
 *
 * Next.js sentinel digests:
 * - `NEXT_REDIRECT;<type>;<url>;<statusCode>;`  - from `redirect()` / `permanentRedirect()`
 * - `NEXT_HTTP_ERROR_FALLBACK;<statusCode>`     - from `notFound()` and future HTTP-error helpers
 */

/**
 * Returns `true` when the error should be forwarded to Sentry.
 *
 * Skips Next.js internal control-flow throws (`notFound()`, `redirect()`)
 * so they do not appear as spurious errors in the Sentry issue stream.
 */
export function shouldCapture(error: unknown): boolean {
  if (
    error !== null &&
    typeof error === "object" &&
    "digest" in error &&
    typeof (error as { digest: unknown }).digest === "string"
  ) {
    const digest = (error as { digest: string }).digest;

    // notFound() / HTTP-error helpers: "NEXT_HTTP_ERROR_FALLBACK;<code>"
    if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return false;

    // redirect() / permanentRedirect(): "NEXT_REDIRECT;<type>;<url>;<code>;"
    if (digest.startsWith("NEXT_REDIRECT")) return false;
  }

  return true;
}
