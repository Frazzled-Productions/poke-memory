/**
 * Tests for POST /api/push/resubscribe (#1858 F35).
 *
 * Verifies authentication guard, payload validation, delete-then-insert
 * DB logic, and error propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks - factories must not reference outer variables (hoisting rule).
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks.
// ---------------------------------------------------------------------------

import { POST } from "./route";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request("https://pokememory.com/api/push/resubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type SupabaseMockOpts = {
  userId?: string | null;
  authError?: boolean;
  deleteError?: boolean;
  insertError?: boolean;
};

function makeSupabaseMock(opts: SupabaseMockOpts = {}) {
  const { userId = "user-1", authError = false, deleteError = false, insertError = false } = opts;

  const deleteMock = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: deleteError ? { message: "delete error" } : null }),
    }),
  });

  const insertMock = vi.fn().mockResolvedValue({
    error: insertError ? { message: "insert error" } : null,
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authError ? null : { id: userId } },
        error: authError ? { message: "auth error" } : null,
      }),
    },
    from: vi.fn().mockReturnValue({
      delete: deleteMock,
      insert: insertMock,
    }),
  };

  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  return { client, deleteMock, insertMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/push/resubscribe", () => {
  it("returns 401 when the user is not authenticated", async () => {
    makeSupabaseMock({ authError: true });
    const res = await POST(makeRequest({ endpoint: "https://push.example.com/1", p256dh: "a", auth: "b" }));
    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns 400 when the body is not valid JSON", async () => {
    makeSupabaseMock();
    const req = new Request("https://pokememory.com/api/push/resubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    makeSupabaseMock();
    const res = await POST(makeRequest({ endpoint: "https://push.example.com/1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when endpoint is empty string", async () => {
    makeSupabaseMock();
    const res = await POST(makeRequest({ endpoint: "", p256dh: "a", auth: "b" }));
    expect(res.status).toBe(400);
  });

  it("performs delete-then-insert and returns 200 on success", async () => {
    const { deleteMock, insertMock } = makeSupabaseMock();
    const res = await POST(makeRequest({
      endpoint: "https://push.example.com/sub/1",
      p256dh: "p256dhkey",
      auth: "authkey",
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
    // delete was called before insert
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    // insert was called with the correct shape
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-1",
      endpoint: "https://push.example.com/sub/1",
      p256dh: "p256dhkey",
      auth_secret: "authkey",
    }));
  });

  it("returns 500 when the delete fails", async () => {
    makeSupabaseMock({ deleteError: true });
    const res = await POST(makeRequest({
      endpoint: "https://push.example.com/sub/1",
      p256dh: "p256dhkey",
      auth: "authkey",
    }));
    expect(res.status).toBe(500);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("delete_failed");
  });

  it("returns 500 when the insert fails", async () => {
    makeSupabaseMock({ insertError: true });
    const res = await POST(makeRequest({
      endpoint: "https://push.example.com/sub/1",
      p256dh: "p256dhkey",
      auth: "authkey",
    }));
    expect(res.status).toBe(500);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("insert_failed");
  });
});
