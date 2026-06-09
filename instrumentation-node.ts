/**
 * Sentry Node.js runtime initialisation.
 *
 * Imported dynamically by `instrumentation.ts` only when
 * `process.env.NEXT_RUNTIME === 'nodejs'` — never bundled into the Edge
 * runtime (which lacks Node APIs that the Node SDK requires).
 *
 * With no DSN the SDK is a safe no-op: `Sentry.init({ dsn: undefined })`
 * does not throw, does not open a network connection, and does not affect the
 * build. Source-map upload (controlled by `SENTRY_AUTH_TOKEN`) is equally
 * optional — the `withSentryConfig` wrapper in `next.config.ts` warns and
 * continues when the token is absent.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture a small fraction of transactions for performance monitoring.
  // Override at deploy time via SENTRY_TRACES_SAMPLE_RATE env var.
  tracesSampleRate:
    Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),

  // Session Replay is not enabled — zero overhead for users.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
