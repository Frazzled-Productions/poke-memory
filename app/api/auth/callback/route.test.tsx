/**
 * Tests for GET /api/auth/callback
 *
 * Verifies OAuth error-code handling and redirect targets. The route exchanges
 * an OAuth authorisation code for a session and redirects accordingly:
 *   - Success  → /auth/callback-complete
 *   - Failure  → /?error=auth  (no code, or exchangeCodeForSession returns error)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks - hoisted so vi.mock runs before imports.
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { GET } from "./route";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a GET request for the callback URL with optional query params. */
function makeCallbackRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/auth/callback");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString(), { method: "GET" });
}

function makeSupabaseMock(overrides: {
  exchangeError?: unknown;
} = {}) {
  const exchangeMock = vi.fn().mockResolvedValue({
    data: overrides.exchangeError ? null : { session: { access_token: "tok" } },
    error: overrides.exchangeError ?? null,
  });

  const client = {
    auth: {
      exchangeCodeForSession: exchangeMock,
    },
  };

  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return { client, exchangeMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/auth/callback", () => {
  const BASE = "http://localhost:3000";
  const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure NEXT_PUBLIC_SITE_URL is unset so the fallback default is tested
    // unless the test explicitly overrides it.
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    // Restore env var to avoid cross-test contamination.
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    }
  });

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------

  it("redirects to /auth/callback-complete when code exchange succeeds", async () => {
    makeSupabaseMock();

    const res = await GET(makeCallbackRequest({ code: "valid-auth-code" }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${BASE}/auth/callback-complete`);
  });

  it("calls exchangeCodeForSession with the code from the query string", async () => {
    const { exchangeMock } = makeSupabaseMock();

    await GET(makeCallbackRequest({ code: "abc123" }));

    expect(exchangeMock).toHaveBeenCalledOnce();
    expect(exchangeMock).toHaveBeenCalledWith("abc123");
  });

  // -------------------------------------------------------------------------
  // OAuth error codes - failure redirect
  // -------------------------------------------------------------------------

  it("redirects to /?error=auth when no code param is present", async () => {
    // No code → route skips exchange and goes straight to error redirect.
    const res = await GET(makeCallbackRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${BASE}/?error=auth`);
  });

  it("redirects to /?error=auth when exchangeCodeForSession returns an error", async () => {
    makeSupabaseMock({ exchangeError: new Error("invalid grant") });

    const res = await GET(makeCallbackRequest({ code: "bad-code" }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${BASE}/?error=auth`);
  });

  it("does not call exchangeCodeForSession when code is absent", async () => {
    // The route short-circuits before createClient when there is no code, so no
    // Supabase mock is needed - calling createClient here would be a bug.
    const createClientMock = createClient as ReturnType<typeof vi.fn>;

    await GET(makeCallbackRequest());

    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("redirects to /?error=auth when an empty-string code is provided", async () => {
    // An empty-string code is falsy - the route treats it the same as absent.
    const res = await GET(makeCallbackRequest({ code: "" }));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${BASE}/?error=auth`);
  });

  // -------------------------------------------------------------------------
  // Redirect target uses NEXT_PUBLIC_SITE_URL when set
  // -------------------------------------------------------------------------

  it("uses NEXT_PUBLIC_SITE_URL as the base for redirects when set", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://pokememory.com";
    makeSupabaseMock();

    const success = await GET(makeCallbackRequest({ code: "code" }));
    expect(success.headers.get("location")).toBe("https://pokememory.com/auth/callback-complete");
  });

  it("uses NEXT_PUBLIC_SITE_URL base for the error redirect when code exchange fails", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://pokememory.com";
    makeSupabaseMock({ exchangeError: new Error("denied") });

    const failure = await GET(makeCallbackRequest({ code: "code" }));
    expect(failure.headers.get("location")).toBe("https://pokememory.com/?error=auth");
  });
});
