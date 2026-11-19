/**
 * Runs the app routes for one Cron Trigger firing (design D2). Used by
 * worker/index.ts, kept here so it is unit-tested without a Worker runtime.
 *
 * Each route is POSTed with `Authorization: Bearer <CRON_SHARED_SECRET>`
 * through `fetchRoute` (the Worker's own fetch handler, so there is no network
 * hop), handed to `waitUntil` so the runtime keeps the invocation alive, and
 * its status logged. One failing route never stops the others.
 */

export interface CronRunOptions {
  routes: readonly string[];
  /** Any absolute origin; the request never leaves the Worker. */
  origin: string;
  /** CRON_SHARED_SECRET. Missing: nothing runs and an error is logged. */
  secret: string | undefined;
  fetchRoute: (request: Request) => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  log?: Pick<Console, "info" | "error">;
}

export interface CronRouteResult {
  route: string;
  /** HTTP status, or null when the call threw. */
  status: number | null;
  error?: string;
}

export function runCronRoutes(options: CronRunOptions): Promise<CronRouteResult[]> {
  const { routes, origin, secret, fetchRoute, waitUntil, log = console } = options;
  if (!secret) {
    log.error(`[cron] CRON_SHARED_SECRET is not set; skipped ${routes.join(", ") || "nothing"}`);
    return Promise.resolve(routes.map((route) => ({ route, status: null, error: "no secret" })));
  }

  const runs = routes.map(async (route): Promise<CronRouteResult> => {
    try {
      const request = new Request(new URL(route, origin), {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const response = await fetchRoute(request);
      // Drain the body so the runtime can release the response.
      await response.text().catch(() => undefined);
      (response.ok ? log.info : log.error)(`[cron] POST ${route} -> ${response.status}`);
      return { route, status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[cron] POST ${route} failed: ${message}`);
      return { route, status: null, error: message };
    }
  });
  for (const run of runs) waitUntil(run);
  return Promise.all(runs);
}
