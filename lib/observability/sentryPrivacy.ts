/**
 * Shared Sentry privacy configuration, imported by every `Sentry.init` call
 * site (`instrumentation-client.ts`, `instrumentation-node.ts`,
 * `instrumentation-edge.ts`). One module so the three runtimes cannot drift;
 * `sentryPrivacy.test.ts` fails if an init omits it.
 *
 * Why this exists: @sentry/nextjs v11 removed `sendDefaultPii` and replaced it
 * with `dataCollection`, whose defaults collect MORE than v10 did (user info
 * and IP, cookies, headers, request and response bodies, query strings,
 * database query data, queue arguments, stack-frame variables). Poke Memory
 * only wants anonymous error and performance telemetry, so everything is
 * switched off explicitly and `beforeSend` scrubs what the SDK might still
 * attach. Never call `Sentry.setUser` anywhere.
 */
import type { Breadcrumb, ErrorEvent, init } from "@sentry/nextjs";

// `DataCollection` is not re-exported by @sentry/nextjs; derive it from init.
type DataCollection = NonNullable<
  NonNullable<Parameters<typeof init>[0]>["dataCollection"]
>;

/** Everything personal-data-shaped that v11 would otherwise collect, off. */
export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  stackFrameVariables: false,
  databaseQueryData: false,
  queues: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
} as const satisfies DataCollection;

const SCRUBBED_BREADCRUMB_CATEGORIES = new Set(["fetch", "xhr"]);

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (
    breadcrumb.category !== undefined &&
    SCRUBBED_BREADCRUMB_CATEGORIES.has(breadcrumb.category) &&
    breadcrumb.data !== undefined
  ) {
    const { data: _data, ...rest } = breadcrumb;
    return rest;
  }
  return breadcrumb;
}

/**
 * Defence in depth behind `SENTRY_DATA_COLLECTION`: removes user, cookie,
 * body, query-string and header data from an error event, and drops `data`
 * from fetch/xhr breadcrumbs (it carries URLs). Mutates and returns the event.
 *
 * `beforeSendTransaction` is deliberately not set: v11 streams spans by
 * default (`traceLifecycle: 'stream'`), and the SDK ignores that hook then.
 * Span data is governed by `SENTRY_DATA_COLLECTION`.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.headers;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  return event;
}

/**
 * Keeps the v10 environment names (`vercel-production`, `vercel-preview`) so
 * existing Sentry alerts and filters keep matching; v11 would otherwise report
 * the bare `production` / `preview`. Pass the runtime's Vercel env value
 * (`VERCEL_ENV`, or `NEXT_PUBLIC_VERCEL_ENV` in the browser bundle, which must
 * be read as a literal `process.env.X` for Next to inline it).
 */
export function sentryEnvironment(
  vercelEnv: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | undefined {
  if (vercelEnv) return `vercel-${vercelEnv}`;
  return nodeEnv;
}
