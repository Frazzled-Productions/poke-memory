/**
 * Tests for useSyncOnUnload (#581). The hook registers visibilitychange and
 * pagehide listeners. visibilitychange uses fetch+keepalive (response code
 * observable, partial failure surfaces as `lastPushFailed: true`); pagehide
 * uses sendBeacon (response invisible, trusts the browser's "queued" boolean).
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSyncOnUnload } from "@/lib/sync/useSyncOnUnload";
import type { SyncStatus } from "@/lib/sync/persistence";

vi.mock("@/lib/sync/cloud", () => ({
  buildBeaconPayload: vi.fn((cards) => new Blob([JSON.stringify({ cards })], { type: "application/json" })),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(),
  saveSyncStatus: vi.fn(),
}));

import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";

const ZERO_STATUS: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
    lastSeenResetAt: null,
};

function mockUnsynced(count: number) {
  return () =>
    Array.from({ length: count }, (_, i) => ({ id: i, cardType: "name", subjectKey: String(i) })) as never[];
}

function fireVisibilityHidden() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  window.dispatchEvent(new Event("visibilitychange"));
}

function firePagehide() {
  window.dispatchEvent(new Event("pagehide"));
}

describe("useSyncOnUnload — pagehide path (sendBeacon)", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
    // jsdom does not define navigator.sendBeacon by default; install a fake.
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  it("stamps lastPushAt when sendBeacon queues successfully", () => {
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));

    act(() => firePagehide());

    expect(beacon).toHaveBeenCalledOnce();
    expect(saveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        lastPushFailed: false,
        failedCardCount: 0,
        lastPushAt: expect.any(String),
      }),
    );
  });

  it("flags failure when sendBeacon rejects", () => {
    beacon.mockReturnValue(false);
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(3)));

    act(() => firePagehide());

    expect(saveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        lastPushFailed: true,
        failedCardCount: 3,
      }),
    );
  });

  it("skips entirely when there are no unsynced cards", () => {
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(0)));

    act(() => firePagehide());

    expect(beacon).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
  });
});

describe("useSyncOnUnload — visibilitychange path (fetch+keepalive)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("treats 2xx as success: lastPushFailed false, lastPushAt stamped", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));
    act(() => fireVisibilityHidden());

    await waitFor(() =>
      expect(saveSyncStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          lastPushFailed: false,
          failedCardCount: 0,
          lastPushAt: expect.any(String),
        }),
      ),
    );
  });

  it("treats 502 (partial_failure) as failure: lastPushFailed true, failedCardCount preserved", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(5)));
    act(() => fireVisibilityHidden());

    await waitFor(() =>
      expect(saveSyncStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          lastPushFailed: true,
          failedCardCount: 5,
        }),
      ),
    );
    // lastPushAt must NOT be stamped on failure — UI would otherwise show
    // "Last synced: just now" while cloud is still inconsistent.
    const call = vi.mocked(saveSyncStatus).mock.calls.at(-1)?.[0];
    expect(call?.lastPushAt).toBe(null);
  });

  it("treats network rejection as failure", async () => {
    fetchSpy.mockRejectedValue(new TypeError("network down"));

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(1)));
    act(() => fireVisibilityHidden());

    await waitFor(() =>
      expect(saveSyncStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          lastPushFailed: true,
          failedCardCount: 1,
        }),
      ),
    );
  });

  it("passes keepalive: true so the request survives the page hide", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(1)));
    act(() => fireVisibilityHidden());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
  });
});
