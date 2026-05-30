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
  savePendingQueue: vi.fn(),
  clearPendingQueue: vi.fn(),
}));

vi.mock("@/lib/sync/backgroundSync", () => ({
  registerBackgroundSync: vi.fn().mockResolvedValue(undefined),
}));

import { loadSyncStatus, saveSyncStatus, savePendingQueue, clearPendingQueue } from "@/lib/sync/persistence";
import { registerBackgroundSync } from "@/lib/sync/backgroundSync";

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
  structuralSyncError: null,
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

// ─── Pre-beacon pending-queue persistence (#1288) ─────────────────────────────
//
// useSyncOnUnload must persist the unsynced cards to localStorage BEFORE
// sending the beacon / fetch. This guarantees that if the beacon fails AND the
// OS kills the page before the 500 ms debounce or React cleanup runs, the cards
// survive in the persisted queue for useOnlineReconnectSync on the next open.

describe("useSyncOnUnload — pre-beacon queue persistence (#1288)", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    fetchSpy = vi.spyOn(global, "fetch");
    vi.clearAllMocks();
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("persists the queue to localStorage before calling sendBeacon (pagehide)", () => {
    const callOrder: string[] = [];
    vi.mocked(savePendingQueue).mockImplementation(() => { callOrder.push("savePendingQueue"); });
    beacon.mockImplementation(() => { callOrder.push("sendBeacon"); return true; });

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));
    act(() => firePagehide());

    expect(callOrder.indexOf("savePendingQueue")).toBeLessThan(callOrder.indexOf("sendBeacon"));
  });

  it("persists the queue to localStorage before calling fetch (visibilitychange)", async () => {
    const callOrder: string[] = [];
    vi.mocked(savePendingQueue).mockImplementation(() => { callOrder.push("savePendingQueue"); });
    fetchSpy.mockImplementation(async () => {
      callOrder.push("fetch");
      return new Response(null, { status: 200 });
    });

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));
    act(() => fireVisibilityHidden());

    await waitFor(() => expect(callOrder).toContain("fetch"));
    expect(callOrder.indexOf("savePendingQueue")).toBeLessThan(callOrder.indexOf("fetch"));
  });

  it("clears the queue after a successful sendBeacon (pagehide)", () => {
    beacon.mockReturnValue(true);
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));
    act(() => firePagehide());

    expect(clearPendingQueue).toHaveBeenCalled();
  });

  it("does NOT clear the queue after a failed sendBeacon (pagehide)", () => {
    beacon.mockReturnValue(false);
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));
    act(() => firePagehide());

    expect(clearPendingQueue).not.toHaveBeenCalled();
  });

  it("clears the queue after a successful fetch (visibilitychange)", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));
    act(() => fireVisibilityHidden());

    await waitFor(() => expect(clearPendingQueue).toHaveBeenCalled());
  });

  it("does NOT clear the queue when no unsynced cards", () => {
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(0)));
    act(() => firePagehide());

    expect(savePendingQueue).not.toHaveBeenCalled();
    expect(clearPendingQueue).not.toHaveBeenCalled();
  });
});

// ─── Superuser write-guard (#754) ─────────────────────────────────────────────
//
// ReviewSession.tsx passes null client/userId to useSyncOnUnload when
// anyFlagOn is true, so neither the pagehide nor visibilitychange path can fire
// a beacon or fetch during a QA session. These tests verify the null short-circuit
// holds for both transport paths.

describe("useSyncOnUnload — superuser write-guard (null client/userId)", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("does not call sendBeacon on pagehide when client is null (superuser guarded)", () => {
    // Simulates ReviewSession.tsx passing syncClient=null when anyFlagOn is true.
    renderHook(() => useSyncOnUnload(null, FAKE_USER, mockUnsynced(2)));

    act(() => firePagehide());

    expect(beacon).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
  });

  it("does not call sendBeacon on pagehide when userId is null (superuser guarded)", () => {
    // Simulates ReviewSession.tsx passing syncUserId=null when anyFlagOn is true.
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, null, mockUnsynced(2)));

    act(() => firePagehide());

    expect(beacon).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
  });

  it("does not call sendBeacon on pagehide when both client and userId are null (superuser guarded)", () => {
    // The canonical superuser-guarded call: both are null simultaneously.
    renderHook(() => useSyncOnUnload(null, null, mockUnsynced(3)));

    act(() => firePagehide());

    expect(beacon).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
  });

  it("does not call fetch on visibilitychange when client is null (superuser guarded)", async () => {
    renderHook(() => useSyncOnUnload(null, FAKE_USER, mockUnsynced(2)));

    act(() => fireVisibilityHidden());

    // Settle any microtasks — the hook should not have started an async path.
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
  });

  it("does not call fetch on visibilitychange when userId is null (superuser guarded)", async () => {
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, null, mockUnsynced(2)));

    act(() => fireVisibilityHidden());

    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveSyncStatus).not.toHaveBeenCalled();
  });
});

// ─── Background Sync registration (#1054) ────────────────────────────────────
//
// When a push fails, useSyncOnUnload should register the Background Sync tag
// so the service worker can replay the queue after the app is closed.

describe("useSyncOnUnload — Background Sync registration (#1054)", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: beacon,
      configurable: true,
      writable: true,
    });
    fetchSpy = vi.spyOn(global, "fetch");
    vi.clearAllMocks();
    vi.mocked(loadSyncStatus).mockReturnValue(ZERO_STATUS);
    vi.mocked(registerBackgroundSync).mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    fetchSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("registers Background Sync when sendBeacon is rejected (beacon returns false)", async () => {
    beacon.mockReturnValue(false);
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));

    act(() => firePagehide());

    // registerBackgroundSync is called asynchronously (void fire-and-forget).
    await waitFor(() => expect(registerBackgroundSync).toHaveBeenCalledOnce());
  });

  it("does NOT register Background Sync when sendBeacon succeeds", () => {
    beacon.mockReturnValue(true);
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(2)));

    act(() => firePagehide());

    expect(registerBackgroundSync).not.toHaveBeenCalled();
  });

  it("registers Background Sync when fetch returns non-2xx (visibilitychange path)", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(3)));

    act(() => fireVisibilityHidden());

    await waitFor(() => expect(registerBackgroundSync).toHaveBeenCalledOnce());
  });

  it("does NOT register Background Sync when fetch succeeds (visibilitychange path)", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(3)));

    act(() => fireVisibilityHidden());

    await waitFor(() => expect(saveSyncStatus).toHaveBeenCalled());
    expect(registerBackgroundSync).not.toHaveBeenCalled();
  });

  it("registers Background Sync when fetch throws (network offline)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("network down"));
    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER, mockUnsynced(1)));

    act(() => fireVisibilityHidden());

    await waitFor(() => expect(registerBackgroundSync).toHaveBeenCalledOnce());
  });
});
