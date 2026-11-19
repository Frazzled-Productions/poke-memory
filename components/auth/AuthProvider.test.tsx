/**
 * Tests for AuthProvider (lib/auth/AuthContext.tsx).
 *
 * The Better Auth browser client (useSession, listAccounts) and the data
 * client module are stubbed - no real network calls are made.
 *
 * Coverage:
 *  - loading while the session is pending, then cleared
 *  - the signed-in user as an AppUser with linked accounts (listAccounts)
 *  - sign-in and sign-out through session changes
 *  - a session refetch for the same user does not reload accounts
 *  - the client field: present, or null when createClient() throws
 *  - the mock-auth seam: MOCK_USER with no session lookup
 */

import { render, screen, act, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock: @/lib/auth/client - a controllable useSession store + listAccounts.
// ---------------------------------------------------------------------------

type FakeSession = { data: { user: Record<string, unknown> } | null; isPending: boolean };

const sessionStore = vi.hoisted(() => {
  let state: { data: { user: Record<string, unknown> } | null; isPending: boolean } = { data: null, isPending: true };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: typeof state) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
});

const mockListAccounts = vi.fn();
const mockUseSessionCalls = vi.fn();

vi.mock("@/lib/auth/client", () => ({
  authClient: {
    useSession: () => {
      mockUseSessionCalls();
      return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get) as FakeSession;
    },
    listAccounts: (...args: unknown[]) => mockListAccounts(...args),
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
const mockCreateClient = vi.mocked(createClient);

import { AuthProvider, useAuth } from "@/lib/auth/AuthContext";
import { MOCK_USER } from "@/lib/auth/mockAuth";

function AuthConsumer() {
  const { user, loading, supabase } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.id : "null"}</span>
      <span data-testid="providers">{user ? user.identities.map((i) => i.provider).join(",") : ""}</span>
      <span data-testid="username">{user?.user_metadata.username ?? ""}</span>
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

const SESSION_USER = {
  id: "user-abc",
  email: "ash@users.noreply.pokememory.internal",
  name: "ash",
  image: null,
  username: "ash",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockListAccounts.mockReset();
    mockUseSessionCalls.mockReset();
    mockCreateClient.mockReset();
    mockCreateClient.mockReturnValue({} as ReturnType<typeof createClient>);
    sessionStore.set({ data: null, isPending: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("starts with loading: true while the session is pending, then clears to false", async () => {
    renderWithProvider();
    expect(screen.getByTestId("loading").textContent).toBe("true");

    act(() => sessionStore.set({ data: null, isPending: false }));

    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(mockListAccounts).not.toHaveBeenCalled();
  });

  it("sets the user with their linked accounts when a session exists", async () => {
    mockListAccounts.mockResolvedValue({
      data: [
        { providerId: "credential", accountId: "user-abc" },
        { providerId: "github", accountId: "42" },
      ],
      error: null,
    });
    sessionStore.set({ data: { user: SESSION_USER }, isPending: false });
    renderWithProvider();

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user-abc"));
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(screen.getByTestId("providers").textContent).toBe("email,github");
    expect(screen.getByTestId("username").textContent).toBe("ash");
  });

  it("still signs the user in when listAccounts fails", async () => {
    mockListAccounts.mockRejectedValue(new Error("network"));
    sessionStore.set({ data: { user: SESSION_USER }, isPending: false });
    renderWithProvider();

    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user-abc"));
    expect(screen.getByTestId("providers").textContent).toBe("");
  });

  it("follows sign-in and sign-out through session changes", async () => {
    mockListAccounts.mockResolvedValue({ data: [], error: null });
    sessionStore.set({ data: null, isPending: false });
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));

    act(() => sessionStore.set({ data: { user: SESSION_USER }, isPending: false }));
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user-abc"));

    act(() => sessionStore.set({ data: null, isPending: false }));
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("null"));
  });

  it("does not reload accounts when the session refetches for the same user", async () => {
    mockListAccounts.mockResolvedValue({ data: [], error: null });
    sessionStore.set({ data: { user: SESSION_USER }, isPending: false });
    renderWithProvider();
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("user-abc"));

    act(() => sessionStore.set({ data: { user: { ...SESSION_USER } }, isPending: false }));
    await act(async () => {});

    expect(mockListAccounts).toHaveBeenCalledTimes(1);
  });

  it("exposes the supabase client in context when createClient succeeds", () => {
    renderWithProvider();
    expect(screen.getByTestId("supabase").textContent).toBe("present");
  });

  it("renders children with supabase: null when createClient throws", () => {
    mockCreateClient.mockImplementation(() => {
      throw new Error("Missing env vars");
    });
    renderWithProvider();
    expect(screen.getByTestId("supabase").textContent).toBe("null");
  });

  it("with the mock-auth seam, starts signed in as MOCK_USER and never reads the session", () => {
    vi.stubEnv("NEXT_PUBLIC_E2E_AUTH_MOCK", "1");
    renderWithProvider();
    expect(screen.getByTestId("user").textContent).toBe(MOCK_USER.id);
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(mockUseSessionCalls).not.toHaveBeenCalled();
  });
});
