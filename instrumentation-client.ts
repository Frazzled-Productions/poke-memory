/**
 * Next.js client-side instrumentation (Next 15.3+ stable feature).
 *
 * Runs in the browser on page load. Initialises the Sentry browser SDK and
 * exports the `onRouterTransitionStart` hook so Sentry can add navigation
 * breadcrumbs for client-side route transitions.
 *
 * With no DSN (`NEXT_PUBLIC_SENTRY_DSN` unset) `Sentry.init({ dsn: undefined })`
 * is a safe no-op: no network connections are opened and no errors are thrown.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture a small fraction of page-load and navigation transactions.
  // Override at deploy time via NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE env var
  // (must carry the NEXT_PUBLIC_ prefix so Vercel inlines it into the browser
  // bundle; the non-public SENTRY_TRACES_SAMPLE_RATE is only available
  // server-side and is always undefined in the browser).
  tracesSampleRate:
    Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),

  // Session Replay is disabled (privacy + bandwidth). Set to a non-zero value
  // only if Replay is deliberately enabled and the privacy notice is updated.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

/**
 * Called by Next.js before each client-side route transition.
 * Sentry uses this to attach navigation breadcrumbs to the active trace.
 */
export function onRouterTransitionStart(
  url: string,
  _navigationType: "push" | "replace" | "traverse",
): void {
  Sentry.addBreadcrumb({
    category: "navigation",
    message: url,
    level: "info",
  });
}
