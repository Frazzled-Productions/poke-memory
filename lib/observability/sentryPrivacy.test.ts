/**
 * Privacy guard for the Sentry v11 upgrade. v11 collects more than v10 unless
 * `dataCollection` is set, so every `Sentry.init` must use the shared
 * constant and scrubber from sentryPrivacy.ts. The forcing-function tests
 * import each instrumentation file for real with `@sentry/nextjs` mocked at
 * the module boundary and read the options each one passes to `init`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import {
  SENTRY_DATA_COLLECTION,
  scrubSentryEvent,
  sentryEnvironment,
} from "@/lib/observability/sentryPrivacy";

const { mockInit } = vi.hoisted(() => ({ mockInit: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  init: mockInit,
  addBreadcrumb: vi.fn(),
  captureRequestError: vi.fn(),
}));

const INIT_MODULES = [
  ["instrumentation-client", () => import("@/instrumentation-client")],
  ["instrumentation-node", () => import("@/instrumentation-node")],
  ["instrumentation-edge", () => import("@/instrumentation-edge")],
] as const;

describe("every Sentry.init passes the shared privacy config", () => {
  beforeEach(() => {
    mockInit.mockClear();
    vi.resetModules();
  });

  it.each(INIT_MODULES)("%s", async (_name, load) => {
    await load();
    // resetModules gave the init file a fresh copy of the shared module, so
    // compare against that same copy rather than the top-level import.
    const shared = await import("@/lib/observability/sentryPrivacy");
    expect(mockInit).toHaveBeenCalledTimes(1);
    const options = mockInit.mock.calls[0][0] as Record<string, unknown>;
    expect(options.dataCollection).toBe(shared.SENTRY_DATA_COLLECTION);
    expect(options.beforeSend).toBe(shared.scrubSentryEvent);
    expect(options).not.toHaveProperty("sendDefaultPii");
  });
});

describe("SENTRY_DATA_COLLECTION", () => {
  it("switches every personal-data category off", () => {
    expect(SENTRY_DATA_COLLECTION).toEqual({
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
    });
  });
});

describe("scrubSentryEvent", () => {
  it("removes user (including IP) and request cookies, data, query string and headers", () => {
    const event = {
      user: { id: "u1", ip_address: "1.2.3.4" },
      request: {
        url: "https://pokememory.com/x",
        method: "GET",
        cookies: { a: "b" },
        data: { secret: 1 },
        query_string: "token=1",
        headers: { cookie: "a=b" },
      },
    } as unknown as ErrorEvent;
    const out = scrubSentryEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request).toEqual({ url: "https://pokememory.com/x", method: "GET" });
  });

  it("strips data from fetch and xhr breadcrumbs only", () => {
    const event = {
      breadcrumbs: [
        { category: "fetch", message: "m", data: { url: "/a?token=1" } },
        { category: "xhr", data: { url: "/b" } },
        { category: "navigation", data: { from: "/a", to: "/b" } },
        { message: "no category", data: { k: 1 } },
      ],
    } as unknown as ErrorEvent;
    const crumbs = scrubSentryEvent(event).breadcrumbs!;
    expect(crumbs[0]).toEqual({ category: "fetch", message: "m" });
    expect(crumbs[1]).toEqual({ category: "xhr" });
    expect(crumbs[2].data).toEqual({ from: "/a", to: "/b" });
    expect(crumbs[3].data).toEqual({ k: 1 });
  });

  it("tolerates an event with no user, request or breadcrumbs", () => {
    const event = { message: "boom" } as ErrorEvent;
    expect(scrubSentryEvent(event)).toEqual({ message: "boom" });
  });
});

describe("sentryEnvironment", () => {
  it("keeps the v10 vercel-* names", () => {
    expect(sentryEnvironment("production", "production")).toBe("vercel-production");
    expect(sentryEnvironment("preview", "production")).toBe("vercel-preview");
  });

  it("falls back to NODE_ENV when there is no Vercel env", () => {
    expect(sentryEnvironment(undefined, "development")).toBe("development");
    expect(sentryEnvironment("", "test")).toBe("test");
  });
});
