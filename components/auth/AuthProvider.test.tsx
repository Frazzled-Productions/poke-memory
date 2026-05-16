/**
 * Tests for AuthProvider (lib/auth/AuthContext.tsx).
 *
 * All tests run in the jsdom vitest project so React rendering works.
 * The Supabase client module is stubbed — no real network calls are made.
 *
 * Coverage:
 *  - getUser() resolution sets user and clears loading
 *  - onAuthStateChange fires on sign-in and sign-out
 *  - tryCreateClient() null-fallback: children rendered with supabase: null,
 *    loading: false when createClient() throws (no env vars)
 */

import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Mock: @/lib/supabase/client
// We control whether createClient() throws or returns our fake client.
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockOnAuthStateChange = vi.fn();

// Build a minimal fake SupabaseClient that satisfies the narrow surface the
// AuthProvider actually calls. Cast via `unknown` to sidestep the deep generic
// signature of SupabaseClient<Database, ...> — the same pattern used in the
// sync test suite (FAKE_CLIENT = {} as unknown as SupabaseClient).
function makeFakeClient(overrides: Partial<{
  getUser: typeof mockGetUser;
  onAuthStateChange: typeof mockOnAuthStateChange;
}> = {}): ReturnType<typeof createClient> {
  return {
    auth: {
      getUser: overrides.getUser ?? mockGetUser,
      onAuthStateChange: overrides.onAuthStateChange ?? mockOnAuthStateChange,
    },
  } as unknown as ReturnType<typeof createClient>;
}

// createClient is called inside useState initialiser — must be mockable at
// module level before the component is imported.
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
const mockCreateClient = vi.mocked(createClient);

// Import after mocks are established.
import { AuthProvider, useAuth } from "@/lib/auth/AuthContext";

// ---------------------------------------------------------------------------
// Helper: a consumer component that reads AuthContext and renders the values.
// ---------------------------------------------------------------------------

function AuthConsumer() {
  const { user, loading, supabase } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.id : "null"}</span>
      <span data-testid="supabase">{supabase ? "present" : "null"}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <AuthConsumer />
    </AuthProvider>,
  );
}

// ---------------------------------------------------------------------------
// Shared fake user
// ---------------------------------------------------------------------------

const FAKE_USER: Partial<User> = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "trainer@pallet.town",
  user_metadata: { user_name: "ash" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: onAuthStateChange returns a subscription that can be unsubscribed.
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    // Default: getUser resolves with no user (guest).
    mockGetUser.mockResolvedValue({ data: { user: null } });
    // Default: createClient returns the fake client.
    mockCreateClient.mockReturnValue(makeFakeClient());
  });

  it("starts with loading: true while getUser is pending, then clears to false", async () => {
    // Use a controllable promise so we can observe the intermediate state.
    let resolve!: (value: { data: { user: null } }) => void;
    const pending = new Promise<{ data: { user: null } }>((r) => { resolve = r; });
    mockGetUser.mockReturnValue(pending);

    renderWithProvider();

    // Loading must be true before the promise settles.
    expect(screen.getByTestId("loading").textContent).toBe("true");

    // Resolve the promise and wait for state to settle.
    await act(async () => { resolve({ data: { user: null } }); });

    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("sets user when getUser resolves with a user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER } });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe(FAKE_USER.id);
    });
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("leaves user as null when getUser resolves with null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("user").textContent).toBe("null");
  });

  it("updates user to signed-in user when onAuthStateChange fires SIGNED_IN", async () => {
    // Capture the listener that AuthProvider registers.
    let capturedListener!: (_event: string, session: { user: Partial<User> } | null) => void;
    mockOnAuthStateChange.mockImplementation((cb) => {
      capturedListener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetUser.mockResolvedValue({ data: { user: null } });

    renderWithProvider();

    // Wait for the initial getUser to settle.
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Simulate a SIGNED_IN event from Supabase Realtime.
    await act(async () => {
      capturedListener("SIGNED_IN", { user: FAKE_USER });
    });

    expect(screen.getByTestId("user").textContent).toBe(FAKE_USER.id);
  });

  it("clears user when onAuthStateChange fires SIGNED_OUT", async () => {
    // Start signed-in.
    mockGetUser.mockResolvedValue({ data: { user: FAKE_USER } });

    let capturedListener!: (_event: string, session: { user: Partial<User> } | null) => void;
    mockOnAuthStateChange.mockImplementation((cb) => {
      capturedListener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe(FAKE_USER.id);
    });

    // Simulate sign-out.
    await act(async () => {
      capturedListener("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("user").textContent).toBe("null");
  });

  it("calls subscription.unsubscribe when the provider unmounts", async () => {
    const unsubscribeSpy = vi.fn();
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: unsubscribeSpy } },
    });
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { unmount } = renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    unmount();

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it("exposes the supabase client in context when createClient succeeds", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByTestId("supabase").textContent).toBe("present");
    });
  });

  // ── tryCreateClient() null-fallback path ────────────────────────────────

  it("renders children with supabase: null and loading: false when createClient throws", () => {
    // Simulate missing env vars: createClient() throws.
    mockCreateClient.mockImplementation(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    });

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    // No getUser call is made, so loading must resolve to false immediately.
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("supabase").textContent).toBe("null");
    expect(screen.getByTestId("user").textContent).toBe("null");
  });

  it("does not call getUser when createClient throws", () => {
    mockCreateClient.mockImplementation(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    });

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("does not subscribe to onAuthStateChange when createClient throws", () => {
    mockCreateClient.mockImplementation(() => {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
    });

    render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>,
    );

    expect(mockOnAuthStateChange).not.toHaveBeenCalled();
  });
});
