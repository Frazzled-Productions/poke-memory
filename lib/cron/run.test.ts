import { describe, expect, it, vi } from "vitest";
import { runCronRoutes } from "./run";

function setup(fetchRoute: (request: Request) => Promise<Response>) {
  const waited: Promise<unknown>[] = [];
  const log = { info: vi.fn(), error: vi.fn() };
  return {
    waited,
    log,
    options: {
      origin: "https://poke-memory.internal",
      secret: "test-secret",
      fetchRoute: vi.fn(fetchRoute),
      waitUntil: (p: Promise<unknown>) => waited.push(p),
      log,
    },
  };
}

describe("runCronRoutes", () => {
  it("POSTs each route with the bearer secret and hands each to waitUntil", async () => {
    const { options, waited, log } = setup(async () => new Response("ok", { status: 200 }));
    const results = await runCronRoutes({ ...options, routes: ["/api/a", "/api/b"] });

    expect(results).toEqual([
      { route: "/api/a", status: 200 },
      { route: "/api/b", status: 200 },
    ]);
    expect(waited).toHaveLength(2);
    const requests = options.fetchRoute.mock.calls.map(([r]) => r as Request);
    expect(requests.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ["POST", "/api/a"],
      ["POST", "/api/b"],
    ]);
    expect(requests.every((r) => r.headers.get("Authorization") === "Bearer test-secret")).toBe(true);
    expect(log.info).toHaveBeenCalledWith("[cron] POST /api/a -> 200");
  });

  it("one failing route does not stop the others", async () => {
    const { options, log } = setup(async (request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/throws") throw new Error("boom");
      if (path === "/api/500") return new Response("no", { status: 500 });
      return new Response("ok");
    });
    const results = await runCronRoutes({
      ...options,
      routes: ["/api/throws", "/api/500", "/api/ok"],
    });
    expect(results).toEqual([
      { route: "/api/throws", status: null, error: "boom" },
      { route: "/api/500", status: 500 },
      { route: "/api/ok", status: 200 },
    ]);
    expect(log.error).toHaveBeenCalledWith("[cron] POST /api/throws failed: boom");
    expect(log.error).toHaveBeenCalledWith("[cron] POST /api/500 -> 500");
  });

  it("runs nothing without CRON_SHARED_SECRET", async () => {
    const { options, log } = setup(async () => new Response("ok"));
    const results = await runCronRoutes({ ...options, secret: undefined, routes: ["/api/a"] });
    expect(options.fetchRoute).not.toHaveBeenCalled();
    expect(results).toEqual([{ route: "/api/a", status: null, error: "no secret" }]);
    expect(log.error).toHaveBeenCalled();
  });

  it("no routes: no calls", async () => {
    const { options, waited } = setup(async () => new Response("ok"));
    expect(await runCronRoutes({ ...options, routes: [] })).toEqual([]);
    expect(waited).toEqual([]);
  });
});
