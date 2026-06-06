import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSignInPull } from "@/lib/sync/useSignInPull";

vi.mock("@/lib/sync/pullAndMerge", () => ({
  pullAndMerge: vi.fn(() => Promise.resolve("ok" as const)),
}));

// guardAccountSwitch is called before pullAndMerge and must be mocked so tests
// do not depend on localStorage / SyncStatus state in jsdom. (#1712)
vi.mock("@/lib/sync/guardAccountSwitch", () => ({
  guardAccountSwitch: vi.fn(() => Promise.resolve()),
}));

import { pullAndMerge } from "@/lib/sync/pullAndMerge";
import { guardAccountSwitch } from "@/lib/sync/guardAccountSwitch";

const mockPullAndMerge = vi.mocked(pullAndMerge);
const mockGuardAccountSwitch = vi.mocked(guardAccountSwitch);

const CLIENT = {} as unknown as SupabaseClient;
const USER_A = "00000000-0000-0000-0000-000000000001";
const USER_B = "00000000-0000-0000-0000-000000000002";

describe("useSignInPull", () => {
  beforeEach(() => {
    mockPullAndMerge.mockClear();
    mockGuardAccountSwitch.mockClear();
  });

  it("pulls once on mount when client and userId are present", async () => {
    await act(async () => {
      renderHook(() => useSignInPull(CLIENT, USER_A));
    });
    expect(mockGuardAccountSwitch).toHaveBeenCalledWith(USER_A);
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);
    expect(mockPullAndMerge).toHaveBeenCalledWith(CLIENT, USER_A, false);
  });

  it("does not pull when client is null", async () => {
    await act(async () => {
      renderHook(() => useSignInPull(null, USER_A));
    });
    expect(mockPullAndMerge).not.toHaveBeenCalled();
    expect(mockGuardAccountSwitch).not.toHaveBeenCalled();
  });

  it("does not pull when userId is null (guest mode)", async () => {
    await act(async () => {
      renderHook(() => useSignInPull(CLIENT, null));
    });
    expect(mockPullAndMerge).not.toHaveBeenCalled();
    expect(mockGuardAccountSwitch).not.toHaveBeenCalled();
  });

  it("does not pull twice when re-rendered with the same userId", async () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: USER_A } },
    );
    await act(async () => {});

    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: USER_A });
    await act(async () => {});
    rerender({ uid: USER_A });
    await act(async () => {});

    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);
  });

  it("pulls again when the userId changes (account switch)", async () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: USER_A } },
    );
    await act(async () => {});

    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: USER_B });
    await act(async () => {});

    expect(mockPullAndMerge).toHaveBeenCalledTimes(2);
    expect(mockPullAndMerge).toHaveBeenLastCalledWith(CLIENT, USER_B, false);
    expect(mockGuardAccountSwitch).toHaveBeenLastCalledWith(USER_B);
  });

  it("pulls again after sign-out → sign-in as the same user", async () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: USER_A as string | null } },
    );
    await act(async () => {});
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: null });
    await act(async () => {});
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: USER_A });
    await act(async () => {});
    expect(mockPullAndMerge).toHaveBeenCalledTimes(2);
  });

  it("guest → sign-in fires one pull", async () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: null as string | null } },
    );
    await act(async () => {});
    expect(mockPullAndMerge).not.toHaveBeenCalled();

    rerender({ uid: USER_A });
    await act(async () => {});

    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);
    expect(mockPullAndMerge).toHaveBeenCalledWith(CLIENT, USER_A, false);
  });

  it("ignores promise rejection from pullAndMerge (defensive - real impl never rejects)", async () => {
    mockPullAndMerge.mockRejectedValueOnce(new Error("network"));
    await act(async () => {
      renderHook(() => useSignInPull(CLIENT, USER_A));
    });
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);
  });

  it("calls guardAccountSwitch before pullAndMerge (ordering invariant)", async () => {
    const callOrder: string[] = [];
    mockGuardAccountSwitch.mockImplementation(async () => { callOrder.push("guard"); });
    mockPullAndMerge.mockImplementation(async () => { callOrder.push("pull"); return "ok" as const; });

    await act(async () => {
      renderHook(() => useSignInPull(CLIENT, USER_A));
    });

    expect(callOrder).toEqual(["guard", "pull"]);
  });
});
