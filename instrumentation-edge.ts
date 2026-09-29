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
import {
  SENTRY_DATA_COLLECTION,
  scrubSentryEvent,
  sentryEnvironment,
} from "@/lib/observability/sentryPrivacy";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Privacy: v11 collects more than v10 by default, so switch it all off and
  // scrub events as a backstop (lib/observability/sentryPrivacy.ts).
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubSentryEvent,

  // Keep the v10 environment names (vercel-production / vercel-preview).
  environment: process.env.SENTRY_ENVIRONMENT ?? sentryEnvironment(process.env.VERCEL_ENV),

  tracesSampleRate:
    Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),

  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});
