/**
 * Tests for POST /api/discord/digest (#1653).
 *
 * Covers:
 *   - 503 on missing env vars
 *   - 401 on missing / bad bearer token
 *   - window_days parsing and clamping
 *   - Empty-week branch (0 submissions): still posts a zero-count digest
 *   - Populated branch: correct category grouping (total, auth, guest)
 *   - CRITICAL: query never selects or sends `message`; response body contains no message
 *   - 502 on DB query error
 *   - 502 on Discord webhook error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Supabase admin client.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import { POST } from "./route";
import { createClient as createAdminClient } from "@supabase/supabase-js";

const mockCreateAdminClient = vi.mocked(createAdminClient);

// ── Environment helpers ──────────────────────────────────────────────────────

function setRequiredEnv() {
  process.env.CRON_SHARED_SECRET = "test-secret-abc123";
  process.env.DISCORD_DIGEST_WEBHOOK_URL = "https://discord.com/api/webhooks/test/digest";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}

function clearEnv() {
  delete process.env.CRON_SHARED_SECRET;
  delete process.env.DISCORD_DIGEST_WEBHOOK_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// ── Request helpers ──────────────────────────────────────────────────────────

const VALID_BEARER = "Bearer test-secret-abc123";

function makeRequest(body: unknown = { window_days: 7 }, authHeader: string | null = VALID_BEARER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader !== null) headers["authorization"] = authHeader;
  return new Request("http://localhost/api/discord/digest", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Build a mock admin client whose `from("feedback").select(...).gte(...)` resolves to data. */
function buildAdminMock(rows: Array<Record<string, unknown>>, queryError?: unknown) {
  const gteChain = vi.fn(() =>
    Promise.resolve({ data: queryError ? null : rows, error: queryError ?? null }),
  );
  const selectChain = vi.fn(() => ({ gte: gteChain }));
  const fromFn = vi.fn(() => ({ select: selectChain }));
  return { client: { from: fromFn }, fromFn, selectChain, gteChain };
}

// ── fetch mock ───────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  setRequiredEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
  vi.clearAllMocks();
});

// ── 503 Misconfiguration ─────────────────────────────────────────────────────

describe("POST /api/discord/digest - misconfiguration", () => {
  it("returns 503 when CRON_SHARED_SECRET is missing", async () => {
    delete process.env.CRON_SHARED_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when DISCORD_DIGEST_WEBHOOK_URL is missing", async () => {
    delete process.env.DISCORD_DIGEST_WEBHOOK_URL;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── 401 Auth ─────────────────────────────────────────────────────────────────

describe("POST /api/discord/digest - auth", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);
    const res = await POST(makeRequest({ window_days: 7 }, null));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong bearer token", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);
    const res = await POST(makeRequest({ window_days: 7 }, "Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Empty-week branch ─────────────────────────────────────────────────────────

describe("POST /api/discord/digest - empty week", () => {
  it("posts a zero-count digest embed when there are no submissions", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ window_days: 7 }));
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; total: number };
    expect(b.ok).toBe(true);
    expect(b.total).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/webhooks/test/digest");

    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ title: string; color: number; fields: Array<{ name: string; value: string }> }>;
    };
    expect(payload.embeds[0].title).toBe("Weekly feedback digest");
    expect(payload.embeds[0].color).toBe(0x3498db);

    const totalField = payload.embeds[0].fields.find((f) => f.name === "Total");
    expect(totalField?.value).toBe("0");
  });
});

// ── Populated branch (category grouping) ──────────────────────────────────────

describe("POST /api/discord/digest - populated week", () => {
  const SAMPLE_ROWS = [
    // Bugs: 2 authenticated, 1 guest
    { id: "id-1", category: "bug", user_id: "user-1", created_at: "2026-06-02T10:00:00Z" },
    { id: "id-2", category: "bug", user_id: "user-2", created_at: "2026-06-03T10:00:00Z" },
    { id: "id-3", category: "bug", user_id: null,     created_at: "2026-06-04T10:00:00Z" },
    // Features: 1 authenticated
    { id: "id-4", category: "feature", user_id: "user-3", created_at: "2026-06-05T10:00:00Z" },
    // Other: 1 guest
    { id: "id-5", category: "other", user_id: null, created_at: "2026-06-06T10:00:00Z" },
  ];

  it("groups counts by category correctly", async () => {
    const adminMock = buildAdminMock(SAMPLE_ROWS);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ window_days: 7 }));
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; total: number };
    expect(b.ok).toBe(true);
    expect(b.total).toBe(5);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = payload.embeds[0].fields;
    const findField = (name: string) => fields.find((f) => f.name === name)!;

    expect(findField("Total").value).toBe("5");
    // Bug: 3 total, 2 auth, 1 guest.
    expect(findField("Bug").value).toBe("3 (2 auth, 1 guest)");
    // Feature: 1 total, 1 auth, 0 guest.
    expect(findField("Feature").value).toBe("1 (1 auth, 0 guest)");
    // Other: 1 total, 0 auth, 1 guest.
    expect(findField("Other").value).toBe("1 (0 auth, 1 guest)");
  });

  it("selects only safe fields (id, category, user_id, created_at) - never message", async () => {
    const adminMock = buildAdminMock(SAMPLE_ROWS);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    await POST(makeRequest({ window_days: 7 }));

    // Verify the select call does NOT request the message column.
    const selectCall = (adminMock.selectChain.mock.calls as unknown as string[][])[0][0];
    expect(selectCall).not.toContain("message");
    // Verify it selects the safe columns.
    expect(selectCall).toContain("id");
    expect(selectCall).toContain("category");
    expect(selectCall).toContain("user_id");
    expect(selectCall).toContain("created_at");
  });

  // CRITICAL: Discord payload must NEVER include message or user_id values.
  it("CRITICAL: Discord webhook payload contains NO message field", async () => {
    const adminMock = buildAdminMock(SAMPLE_ROWS);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    await POST(makeRequest({ window_days: 7 }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payloadStr = init.body as string;
    expect(payloadStr).not.toContain('"message"');
  });

  it("CRITICAL: Discord webhook payload contains NO user_id values", async () => {
    const adminMock = buildAdminMock(SAMPLE_ROWS);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    await POST(makeRequest({ window_days: 7 }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payloadStr = init.body as string;
    // user_id values should not appear in the Discord payload.
    expect(payloadStr).not.toContain("user-1");
    expect(payloadStr).not.toContain("user-2");
    expect(payloadStr).not.toContain("user-3");
  });
});

// ── window_days parsing / clamping ────────────────────────────────────────────

describe("POST /api/discord/digest - window_days", () => {
  it("defaults to 7 when window_days is missing from the body", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; windowDays: number };
    expect(b.windowDays).toBe(7);
  });

  it("clamps window_days above 90 to 90", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ window_days: 999 }));
    const b = (await res.json()) as { ok: boolean; windowDays: number };
    expect(b.windowDays).toBe(90);
  });

  it("clamps window_days below 1 to 1", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ window_days: 0 }));
    const b = (await res.json()) as { ok: boolean; windowDays: number };
    expect(b.windowDays).toBe(1);
  });

  it("defaults to 7 when the body is invalid JSON", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      authorization: VALID_BEARER,
    };
    const req = new Request("http://localhost/api/discord/digest", {
      method: "POST",
      headers,
      body: "not-json",
    });
    const res = await POST(req);
    // Should succeed with default window.
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; windowDays: number };
    expect(b.windowDays).toBe(7);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("POST /api/discord/digest - error handling", () => {
  it("returns 502 when the DB query errors", async () => {
    const adminMock = buildAdminMock([], { message: "DB error" });
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ window_days: 7 }));
    expect(res.status).toBe(502);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("query_failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when Discord webhook returns non-2xx", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);
    fetchMock.mockResolvedValue(new Response("Bad Request", { status: 400 }));

    const res = await POST(makeRequest({ window_days: 7 }));
    expect(res.status).toBe(502);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("webhook_error");
  });

  it("returns 502 when the Discord fetch throws", async () => {
    const adminMock = buildAdminMock([]);
    mockCreateAdminClient.mockReturnValue(adminMock.client as unknown as ReturnType<typeof createAdminClient>);
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(makeRequest({ window_days: 7 }));
    expect(res.status).toBe(502);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("webhook_fetch_failed");
  });
});
