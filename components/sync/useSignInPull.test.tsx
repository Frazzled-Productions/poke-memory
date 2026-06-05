import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSignInPull } from "@/lib/sync/useSignInPull";

vi.mock("@/lib/sync/pullAndMerge", () => ({
  pullAndMerge: vi.fn(() => Promise.resolve("ok" as const)),
}));

import { pullAndMerge } from "@/lib/sync/pullAndMerge";

const mockPullAndMerge = vi.mocked(pullAndMerge);

const CLIENT = {} as unknown as SupabaseClient;
const USER_A = "00000000-0000-0000-0000-000000000001";
const USER_B = "00000000-0000-0000-0000-000000000002";

describe("useSignInPull", () => {
  beforeEach(() => {
    mockPullAndMerge.mockClear();
  });

  it("pulls once on mount when client and userId are present", () => {
    renderHook(() => useSignInPull(CLIENT, USER_A));
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);
    expect(mockPullAndMerge).toHaveBeenCalledWith(CLIENT, USER_A, false);
  });

  it("does not pull when client is null", () => {
    renderHook(() => useSignInPull(null, USER_A));
    expect(mockPullAndMerge).not.toHaveBeenCalled();
  });

  it("does not pull when userId is null (guest mode)", () => {
    renderHook(() => useSignInPull(CLIENT, null));
    expect(mockPullAndMerge).not.toHaveBeenCalled();
  });

  it("does not pull twice when re-rendered with the same userId", () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: USER_A } },
    );
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: USER_A });
    rerender({ uid: USER_A });

    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);
  });

  it("pulls again when the userId changes (account switch)", () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: USER_A } },
    );
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: USER_B });

    expect(mockPullAndMerge).toHaveBeenCalledTimes(2);
    expect(mockPullAndMerge).toHaveBeenLastCalledWith(CLIENT, USER_B, false);
  });

  it("pulls again after sign-out → sign-in as the same user", () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: USER_A as string | null } },
    );
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: null });
    expect(mockPullAndMerge).toHaveBeenCalledTimes(1);

    rerender({ uid: USER_A });
    expect(mockPullAndMerge).toHaveBeenCalledTimes(2);
  });

  it("guest → sign-in fires one pull", () => {
    const { rerender } = renderHook(
      ({ uid }: { uid: string | null }) => useSignInPull(CLIENT, uid),
      { initialProps: { uid: null as string | null } },
    );
    expect(mockPullAndMerge).not.toHaveBeenCalled();

    rerender({ uid: USER_A });

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
});
