/**
 * Tests for POST /api/feedback (#1621).
 *
 * Covers all acceptance-criteria cases:
 *   - Valid categories (bug / feature / other) → 200 { ok: true }
 *   - Invalid category → 400
 *   - Missing / empty message → 400
 *   - Message longer than 2000 chars → truncated to 2000 before insert
 *   - Guest (no session) → user_id: null inserted
 *   - Authenticated user → user_id from session, NOT from any body field
 *   - A body-supplied user_id is ignored (cannot spoof)
 *   - Insert throws → 500 { ok: false }
 *
 * Both Supabase clients are mocked so the test never touches the network.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin (service-role) client.
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

// Mock the server Supabase client used to resolve the session.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { POST } from "./route";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);

/** Build a request with the given JSON body. */
function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Build a mock admin client whose `.from("feedback").insert(...)` resolves to the given result. */
function buildAdminMock(opts: { insertError?: unknown } = {}) {
  const insertFn = vi.fn(() => Promise.resolve({ error: opts.insertError ?? null }));
  const fromFn = vi.fn(() => ({ insert: insertFn }));
  return { client: { from: fromFn }, insertFn, fromFn };
}

/** Build a mock server client that resolves getUser() to the given user (or null for guest). */
function buildServerMock(user: { id: string } | null) {
  const getUserFn = vi.fn(() => Promise.resolve({ data: { user }, error: null }));
  return {
    client: { auth: { getUser: getUserFn } } as unknown as Awaited<ReturnType<typeof createServerClient>>,
    getUserFn,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

// ─── Valid categories ─────────────────────────────────────────────────────────

describe("POST /api/feedback — valid categories", () => {
  const CATEGORIES = ["bug", "feature", "other"] as const;

  for (const cat of CATEGORIES) {
    it(`accepts category '${cat}' and returns 200 { ok: true }`, async () => {
      const adminMock = buildAdminMock();
      const serverMock = buildServerMock(null);
      mockCreateAdminClient.mockReturnValue(
        adminMock.client as unknown as ReturnType<typeof createAdminClient>,
      );
      mockCreateServerClient.mockResolvedValue(
        serverMock.client,
      );

      const res = await POST(makeRequest({ category: cat, message: "Test message" }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);

      // Insert was called with the correct category.
      expect(adminMock.fromFn).toHaveBeenCalledWith("feedback");
      expect(adminMock.insertFn).toHaveBeenCalledWith(
        expect.objectContaining({ category: cat }),
      );
    });
  }
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("POST /api/feedback — input validation", () => {
  it("returns 400 for an invalid category string", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const res = await POST(makeRequest({ category: "spam", message: "hello" }));
    expect(res.status).toBe(400);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("invalid_category");
    expect(adminMock.insertFn).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing category", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const res = await POST(makeRequest({ message: "hello" }));
    expect(res.status).toBe(400);
    expect(adminMock.insertFn).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing message", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const res = await POST(makeRequest({ category: "bug" }));
    expect(res.status).toBe(400);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("missing_message");
    expect(adminMock.insertFn).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty message string", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const res = await POST(makeRequest({ category: "bug", message: "   " }));
    expect(res.status).toBe(400);
    const b = (await res.json()) as { ok: boolean; error: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe("missing_message");
    expect(adminMock.insertFn).not.toHaveBeenCalled();
  });

  it("returns 400 for non-string message", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const res = await POST(makeRequest({ category: "bug", message: 42 }));
    expect(res.status).toBe(400);
    expect(adminMock.insertFn).not.toHaveBeenCalled();
  });
});

// ─── Message truncation ───────────────────────────────────────────────────────

describe("POST /api/feedback — message truncation", () => {
  it("truncates a message longer than 2000 chars to exactly 2000 before inserting", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const longMessage = "x".repeat(3000);
    const res = await POST(makeRequest({ category: "bug", message: longMessage }));
    expect(res.status).toBe(200);

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as { message: string };
    expect(insertArg.message.length).toBe(2000);
    expect(insertArg.message).toBe("x".repeat(2000));
  });

  it("does not truncate a message of exactly 2000 chars", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const exactMessage = "a".repeat(2000);
    const res = await POST(makeRequest({ category: "feature", message: exactMessage }));
    expect(res.status).toBe(200);

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as { message: string };
    expect(insertArg.message.length).toBe(2000);
  });
});

// ─── User id resolution ───────────────────────────────────────────────────────

describe("POST /api/feedback — user_id resolution", () => {
  it("inserts user_id: null for a guest (no session)", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    await POST(makeRequest({ category: "bug", message: "Something broke" }));

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as { user_id: unknown };
    expect(insertArg.user_id).toBeNull();
  });

  it("inserts user_id from the session for an authenticated user", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock({ id: "user-abc-123" });
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    await POST(makeRequest({ category: "feature", message: "Add dark mode" }));

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as { user_id: string };
    expect(insertArg.user_id).toBe("user-abc-123");
  });

  it("ignores a user_id field in the request body (cannot spoof)", async () => {
    const adminMock = buildAdminMock();
    // Session returns user-from-session; body also sends a spoofed user_id.
    const serverMock = buildServerMock({ id: "user-from-session" });
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    await POST(
      makeRequest({
        category: "bug",
        message: "Spoofing attempt",
        user_id: "spoofed-user-id",
      }),
    );

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as { user_id: string };
    // Must use the session-derived id, never the body-supplied one.
    expect(insertArg.user_id).toBe("user-from-session");
    expect(insertArg.user_id).not.toBe("spoofed-user-id");
  });

  it("falls back to user_id: null when getUser throws", async () => {
    const adminMock = buildAdminMock();
    // Server client throws during getUser.
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockRejectedValue(new Error("session error")) },
    } as unknown as Awaited<ReturnType<typeof createServerClient>>);

    const res = await POST(makeRequest({ category: "other", message: "Feedback" }));
    expect(res.status).toBe(200);

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as { user_id: unknown };
    expect(insertArg.user_id).toBeNull();
  });
});

// ─── Optional fields ──────────────────────────────────────────────────────────

describe("POST /api/feedback — optional fields", () => {
  it("passes page and appVersion through to the insert when provided", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    await POST(
      makeRequest({
        category: "bug",
        message: "Crash on load",
        page: "/practice",
        appVersion: "0.10.34",
      }),
    );

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as {
      page: string;
      app_version: string;
    };
    expect(insertArg.page).toBe("/practice");
    expect(insertArg.app_version).toBe("0.10.34");
  });

  it("inserts null for page and app_version when not provided", async () => {
    const adminMock = buildAdminMock();
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    await POST(makeRequest({ category: "other", message: "General feedback" }));

    const insertArg = ((adminMock.insertFn.mock.calls as unknown[][])[0][0]) as {
      page: unknown;
      app_version: unknown;
    };
    expect(insertArg.page).toBeNull();
    expect(insertArg.app_version).toBeNull();
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("POST /api/feedback — error handling", () => {
  it("returns 500 { ok: false } when the insert returns an error", async () => {
    const adminMock = buildAdminMock({ insertError: { message: "DB error" } });
    const serverMock = buildServerMock(null);
    mockCreateAdminClient.mockReturnValue(
      adminMock.client as unknown as ReturnType<typeof createAdminClient>,
    );
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    const res = await POST(makeRequest({ category: "bug", message: "Error case" }));
    expect(res.status).toBe(500);
    const b = (await res.json()) as { ok: boolean };
    expect(b.ok).toBe(false);
  });

  it("returns 500 { ok: false } when insert throws unexpectedly", async () => {
    const serverMock = buildServerMock(null);
    mockCreateServerClient.mockResolvedValue(serverMock.client);

    // Make the admin client itself throw during insert.
    const throwingInsert = vi.fn().mockRejectedValue(new Error("network error"));
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ insert: throwingInsert })),
    } as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ category: "feature", message: "Feature request" }));
    expect(res.status).toBe(500);
    const b = (await res.json()) as { ok: boolean };
    expect(b.ok).toBe(false);
  });

  it("returns 500 { ok: false } when env vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const res = await POST(makeRequest({ category: "bug", message: "test" }));
    expect(res.status).toBe(500);
    const b = (await res.json()) as { ok: boolean };
    expect(b.ok).toBe(false);
  });
});
