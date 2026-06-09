/**
 * Sentry Edge runtime initialisation.
 *
 * Imported dynamically by `instrumentation.ts` only when
 * `process.env.NEXT_RUNTIME === 'edge'`. The Edge SDK is a stripped-down
 * build that works in V8 isolates without Node-specific APIs.
 *
 * With no DSN this is a safe no-op (see instrumentation-node.ts for detail).
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate:
    Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),

  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
