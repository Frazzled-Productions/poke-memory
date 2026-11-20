/**
 * Tests for POST /api/cron/feedback-digest (#1653; moved from Discord to email
 * by Fraser's ruling of 20 November 2026) on the D1 test database.
 *
 * Covers: 503 without CRON_SHARED_SECRET, 401 on a missing / bad bearer,
 * window_days parsing and clamping (and no body at all, as the Cron Trigger
 * sends), the empty week, category grouping (total, auth, guest), the
 * CRITICAL guarantees that neither the message nor user_id reach the email,
 * 502 on a database or Resend error, no key (logged and skipped) and the
 * outbound gate (design D2). `fetch` is mocked: nothing reaches Resend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { POST } from "./route";
import { forUser } from "@/lib/db/scope";
import { insertFeedback } from "@/lib/db/system";
import { createSqliteD1, createTestUser, type SqliteD1 } from "@/lib/db/testing/sqliteD1";
import { spyD1 } from "@/lib/db/testing/spyD1";

const RESEND = "https://api.resend.com/emails";
const VALID_BEARER = "Bearer test-secret-abc123";
const NOW = new Date("2026-11-16T09:00:00.000Z");

let d1: SqliteD1;
let env: Record<string, unknown>;
let alice: string;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  for (const level of ["error", "info"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  d1 = createSqliteD1();
  alice = createTestUser(d1);
  env = {
    DB: d1,
    DEPLOY_ENV: "cloudflare-production",
    CRON_SHARED_SECRET: "test-secret-abc123",
    RESEND_API_KEY: "re_test",
  };
  getCloudflareContext.mockImplementation(async () => ({ env }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  d1.close();
});

function makeRequest(body: unknown = { window_days: 7 }, authHeader: string | null = VALID_BEARER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader !== null) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/cron/feedback-digest", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** A feedback row `age` days old, from a signed-in user or a guest. */
async function feedback(category: "bug" | "feature" | "other", signedIn: boolean, age: number) {
  if (signedIn) {
    await forUser(d1, alice).insert("feedback", {
      category,
      message: "secret message text",
      created_at: daysAgo(age),
    });
  } else {
    // Guests have no user, so they are inserted through the system query.
    await insertFeedback(d1, { user_id: null, category, message: "secret message text", page: null, app_version: null });
  }
}

function email() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const raw = init.body as string;
  return { url, raw, ...(JSON.parse(raw) as { to: string[]; subject: string; text: string }) };
}
const line = (name: string) => email().text.split("\n").find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);

describe("POST /api/cron/feedback-digest - gates", () => {
  it("returns 503 when CRON_SHARED_SECRET is missing", async () => {
    delete env.CRON_SHARED_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "misconfigured" });
  });

  it("logs and skips the email in production when RESEND_API_KEY is missing", async () => {
    delete env.RESEND_API_KEY;
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, total: 0, windowDays: 7, sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("feedback-digest: alert not sent: no RESEND_API_KEY");
  });

  it("returns 401 when the Authorization header is missing or wrong", async () => {
    expect((await POST(makeRequest({}, null))).status).toBe(401);
    expect((await POST(makeRequest({}, "Bearer wrong-secret-xyz789"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/feedback-digest - digest", () => {
  it("emails a zero-count digest when there are no submissions", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, total: 0, windowDays: 7, sent: true });
    expect(email().url).toBe(RESEND);
    expect(email().to).toEqual(["hello@frazzledproductions.com"]);
    expect(email().subject).toBe("Poké Memory: weekly feedback digest");
    expect(line("Total")).toBe("0");
  });

  it("groups counts by category, authenticated against guest, inside the window only", async () => {
    await feedback("bug", true, 1);
    await feedback("bug", true, 2);
    await feedback("bug", false, 0);
    await feedback("feature", true, 6);
    await feedback("other", false, 0);
    await feedback("bug", true, 8); // outside the 7-day window

    const res = await POST(makeRequest());
    expect(await res.json()).toEqual({ ok: true, total: 5, windowDays: 7, sent: true });
    expect(line("Total")).toBe("5");
    expect(line("Bug")).toBe("3 (2 auth, 1 guest)");
    expect(line("Feature")).toBe("1 (1 auth, 0 guest)");
    expect(line("Other")).toBe("1 (0 auth, 1 guest)");
  });

  it("CRITICAL: the email holds neither the message nor any user id", async () => {
    await feedback("bug", true, 1);
    await POST(makeRequest());
    const { raw } = email();
    expect(raw).not.toContain("secret message text");
    expect(raw).not.toContain('"message"');
    expect(raw).not.toContain("user_id");
    expect(raw).not.toContain(alice);
  });

  it.each([
    ["a missing window_days", {}, 7],
    ["no body at all (the Cron Trigger)", undefined, 7],
    ["an invalid JSON body", "not json", 7],
    ["window_days above 90", { window_days: 365 }, 90],
    ["window_days below 1", { window_days: 0 }, 1],
  ])("handles %s", async (_label, body, expected) => {
    const res = await POST(makeRequest(body));
    expect(((await res.json()) as { windowDays: number }).windowDays).toBe(expected);
  });

  it("returns 502 when the database query fails", async () => {
    env.DB = spyD1(d1, {
      before: () => {
        throw new Error("D1_ERROR: down");
      },
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "query_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when Resend answers non-2xx or the fetch throws", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    let res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "email_failed" });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    res = await POST(makeRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "email_failed" });
  });

  it("outside production reads and returns the counts but sends nothing, even with a key", async () => {
    await feedback("bug", false, 0);
    env.DEPLOY_ENV = "cloudflare-preview";
    const res = await POST(makeRequest());
    expect(await res.json()).toEqual({ ok: true, total: 1, windowDays: 7, sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
