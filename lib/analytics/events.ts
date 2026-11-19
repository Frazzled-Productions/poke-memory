// Daily event counts: Poké Memory's replacement for Vercel Analytics custom events (design D9).
//
// `sendEvent` (browser) beacons the one custom event, `app_open`, with its two bucketed
// properties to `/api/event`; `handleEvent` (the Worker, via app/api/event/route.ts) adds one
// to that combination's total for the UTC day in the `events` D1 table
// (db/d1/migrations/0003_events.sql). Nothing personal is read or kept: no IP address, user
// agent, user id, page address, referrer, cookie or time finer than the day.
// Kept free of Next and Cloudflare imports so events.test.ts runs it under plain Node.

/** The only event name the app sends and the endpoint accepts. */
export const EVENT_NAMES = ["app_open"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export const USER_TYPES = ["new", "returning_guest", "signed_in"] as const;
export type UserType = (typeof USER_TYPES)[number];

export const PROGRESS_BUCKETS = ["0", "1-10", "11-50", "50+"] as const;
export type ProgressBucket = (typeof PROGRESS_BUCKETS)[number];

/** The properties of `app_open`, both bucketed so neither can identify anyone. */
export type AppOpenProps = { userType: UserType; progressBucket: ProgressBucket };

/** The bindings the endpoint needs, typed by shape so the tests can pass fakes. */
export type EventEnv = {
  DB: {
    prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
  };
  EVENT_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

const MAX_BODY_BYTES = 200;

const UPSERT =
  "INSERT INTO events (day, name, user_type, progress_bucket, count) VALUES (?1, ?2, ?3, ?4, 1) " +
  "ON CONFLICT (day, name, user_type, progress_bucket) DO UPDATE SET count = count + 1";

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/**
 * Parses a body of exactly `{"name":"app_open","props":{"userType":..,"progressBucket":..}}`.
 * Any other key, name or value is refused, so nothing else can be smuggled into the count.
 */
function parseBody(
  body: string,
): { name: EventName; props: AppOpenProps } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !hasExactKeys(parsed, ["name", "props"])) return null;
  const { name, props } = parsed;
  if (!isOneOf(EVENT_NAMES, name)) return null;
  if (!isPlainObject(props) || !hasExactKeys(props, ["userType", "progressBucket"])) return null;
  if (!isOneOf(USER_TYPES, props.userType)) return null;
  if (!isOneOf(PROGRESS_BUCKETS, props.progressBucket)) return null;
  return { name, props: { userType: props.userType, progressBucket: props.progressBucket } };
}

function reply(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Handles `POST /api/event`. Reads only the `Origin` and `Content-Length` headers and the
 * body, logs nothing, and answers with no body and no cookie: 204 counted, 400 bad body,
 * 403 another origin, 405 not POST, 429 rate-limited, 503 database error.
 */
export async function handleEvent(
  request: Request,
  env: EventEnv,
  now: Date = new Date(),
): Promise<Response> {
  if (request.method !== "POST") return reply(405);

  if (request.headers.get("Origin") !== new URL(request.url).origin) return reply(403);

  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return reply(400);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return reply(400);

  const event = parseBody(body);
  if (!event) return reply(400);

  // Keyed by event name, never by IP address (design D9).
  const { success } = await env.EVENT_LIMITER.limit({ key: event.name });
  if (!success) return reply(429);

  const day = now.toISOString().slice(0, 10);
  try {
    await env.DB.prepare(UPSERT)
      .bind(day, event.name, event.props.userType, event.props.progressBucket)
      .run();
  } catch {
    return reply(503);
  }
  return reply(204);
}

/**
 * Sends one event to the app's own endpoint. Fire and forget: does nothing where
 * `navigator.sendBeacon` is missing, and never throws, so the page always behaves as normal.
 */
export function sendEvent(name: EventName, props: AppOpenProps): void {
  try {
    if (typeof navigator === "undefined" || typeof navigator?.sendBeacon !== "function") return;
    navigator.sendBeacon(
      "/api/event",
      new Blob([JSON.stringify({ name, props })], { type: "application/json" }),
    );
  } catch {
    // Counting is best effort; the app itself must never fail because of it.
  }
}
