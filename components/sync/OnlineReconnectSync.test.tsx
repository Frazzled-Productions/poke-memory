/**
 * Component tests for OnlineReconnectSync.
 *
 * The component is a render-null wrapper that wires together:
 *   - useAuth  → provides client / userId
 *   - useSuperuser → anyFlagOn gates the sync write-guard (null client/userId)
 *   - useOnlineReconnectSync → the actual hook (already covered by its own test)
 *
 * These tests verify that the component mounts, returns null, and correctly
 * passes null credentials when the superuser write-guard is active.
 */

import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = { id: "00000000-0000-0000-0000-000000000000" };

type FakeAuthReturn = { user: { id: string } | null; supabase: SupabaseClient | null };

const mockUseAuth = vi.fn<() => FakeAuthReturn>(() => ({ user: FAKE_USER, supabase: FAKE_CLIENT }));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseSuperuser = vi.fn(() => ({
  anyFlagOn: false,
  flags: { pretendAllMastered: false },
  unlocked: false,
  setFlag: vi.fn(),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

// Capture the arguments passed to useOnlineReconnectSync so we can assert on them.
const mockUseOnlineReconnectSync = vi.fn();

vi.mock("@/lib/sync/useOnlineReconnectSync", () => ({
  useOnlineReconnectSync: (client: unknown, userId: unknown) =>
    mockUseOnlineReconnectSync(client, userId),
}));

// ---------------------------------------------------------------------------
// Import component under test after mocks.
// ---------------------------------------------------------------------------

import { OnlineReconnectSync } from "@/components/sync/OnlineReconnectSync";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OnlineReconnectSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: signed-in, no superuser flags.
    mockUseAuth.mockReturnValue({ user: FAKE_USER, supabase: FAKE_CLIENT });
    mockUseSuperuser.mockReturnValue({
      anyFlagOn: false,
      flags: { pretendAllMastered: false },
      unlocked: false,
      setFlag: vi.fn(),
    });
  });

  it("renders nothing (returns null)", () => {
    const { container } = render(<OnlineReconnectSync />);
    expect(container.firstChild).toBeNull();
  });

  it("passes the real client and userId to useOnlineReconnectSync when signed in with no flags", () => {
    render(<OnlineReconnectSync />);
    expect(mockUseOnlineReconnectSync).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER.id);
  });

  it("passes null client and null userId when anyFlagOn is true (superuser write-guard)", () => {
    mockUseSuperuser.mockReturnValue({
      anyFlagOn: true,
      flags: { pretendAllMastered: true },
      unlocked: true,
      setFlag: vi.fn(),
    });

    render(<OnlineReconnectSync />);

    expect(mockUseOnlineReconnectSync).toHaveBeenCalledWith(null, null);
  });

  it("passes null userId when user is null (guest mode)", () => {
    mockUseAuth.mockReturnValue({ user: null, supabase: FAKE_CLIENT } as FakeAuthReturn);

    render(<OnlineReconnectSync />);

    // anyFlagOn is false, so client passes through; but user?.id is undefined → null.
    expect(mockUseOnlineReconnectSync).toHaveBeenCalledWith(FAKE_CLIENT, null);
  });

  it("passes null for both when signed out AND superuser flag is on", () => {
    mockUseAuth.mockReturnValue({ user: null, supabase: FAKE_CLIENT } as FakeAuthReturn);
    mockUseSuperuser.mockReturnValue({
      anyFlagOn: true,
      flags: { pretendAllMastered: true },
      unlocked: true,
      setFlag: vi.fn(),
    });

    render(<OnlineReconnectSync />);

    expect(mockUseOnlineReconnectSync).toHaveBeenCalledWith(null, null);
  });
});
