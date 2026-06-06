/**
 * Unit tests for guardAccountSwitch (#1712).
 *
 * All external I/O (localStorage, idbDelete, archiveUserData, restoreUserData,
 * clearIdbPendingQueue) is mocked so these tests run in the pure node project
 * without a browser or IndexedDB environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock userArchive ─────────────────────────────────────────────────────────

const mockArchive = vi.fn((_userId: string): Promise<void> => Promise.resolve());
const mockRestore = vi.fn((_userId: string): Promise<void> => Promise.resolve());
const mockClearIdb = vi.fn((): Promise<void> => Promise.resolve());

vi.mock("@/lib/storage/userArchive", () => ({
  archiveUserData: (...args: [string]) => mockArchive(...args),
  restoreUserData: (...args: [string]) => mockRestore(...args),
  clearIdbPendingQueue: () => mockClearIdb(),
}));

// ─── Mock localStorage (set up before the module imports so the guard can
//     write to it synchronously) ────────────────────────────────────────────

function makeMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    clear: () => { store.clear(); },
    _store: store,
  };
}

let storage: ReturnType<typeof makeMockStorage>;

// ─── Imports (after mocks are in place) ──────────────────────────────────────

import { guardAccountSwitch } from "./guardAccountSwitch";
import { loadSyncStatus, saveSyncStatus, type SyncStatus } from "./persistence";
import {
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_SYNC_STATUS,
  KEY_STREAK,
} from "@/lib/storage/keys";

const ZERO_STATUS: SyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
  lastSeenResetAt: null,
  structuralSyncError: null,
  ownerUserId: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  storage = makeMockStorage();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", storage);

  mockArchive.mockClear();
  mockRestore.mockClear();
  mockClearIdb.mockClear();
});

// ─── Guest (null owner) path ──────────────────────────────────────────────────

describe("guest path (ownerUserId === null)", () => {
  it("returns without calling archive, restore, or clearIdb", async () => {
    // SyncStatus with ownerUserId === null (guest / never signed in).
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: null });

    await guardAccountSwitch("user-A");

    expect(mockArchive).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockClearIdb).not.toHaveBeenCalled();
  });

  it("leaves local storage untouched", async () => {
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: null });
    storage.setItem(KEY_STREAK, JSON.stringify(["2026-06-01"]));
    storage.setItem(KEY_SETTINGS, JSON.stringify({ timezone: "Europe/London" }));

    await guardAccountSwitch("user-A");

    // Local data must be unchanged.
    expect(storage.getItem(KEY_STREAK)).not.toBeNull();
    expect(storage.getItem(KEY_SETTINGS)).not.toBeNull();
  });
});

// ─── Same user path ───────────────────────────────────────────────────────────

describe("same-user path (ownerUserId === incomingUserId)", () => {
  it("is a no-op: no archive, no restore, no clear", async () => {
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });

    await guardAccountSwitch("user-A");

    expect(mockArchive).not.toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockClearIdb).not.toHaveBeenCalled();
  });

  it("leaves SyncStatus.ownerUserId unchanged", async () => {
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A", lastPullAt: "2026-05-01T10:00:00.000Z" });

    await guardAccountSwitch("user-A");

    const after = loadSyncStatus();
    expect(after.ownerUserId).toBe("user-A");
    expect(after.lastPullAt).toBe("2026-05-01T10:00:00.000Z");
  });
});

// ─── Different user (switch) path ────────────────────────────────────────────

describe("switch path (ownerUserId !== incomingUserId)", () => {
  it("calls archive(outgoing), clearIdb, restore(incoming) in order", async () => {
    const callOrder: string[] = [];
    mockArchive.mockImplementation(async () => { callOrder.push("archive"); });
    mockClearIdb.mockImplementation(async () => { callOrder.push("clearIdb"); });
    mockRestore.mockImplementation(async () => { callOrder.push("restore"); });

    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });

    await guardAccountSwitch("user-B");

    expect(callOrder).toEqual(["archive", "clearIdb", "restore"]);
  });

  it("archives the outgoing user (user-A) and restores the incoming user (user-B)", async () => {
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });

    await guardAccountSwitch("user-B");

    expect(mockArchive).toHaveBeenCalledWith("user-A");
    expect(mockRestore).toHaveBeenCalledWith("user-B");
  });

  it("wipes per-user LS keys including settings:* after archiving", async () => {
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });
    storage.setItem(KEY_STREAK, JSON.stringify(["2026-06-01"]));
    storage.setItem(KEY_SETTINGS, JSON.stringify({ timezone: "Europe/London" }));
    storage.setItem(KEY_SETTINGS_LAST_PUSHED, JSON.stringify({ version: 1 }));

    // restoreUserData is a no-op (mock returns void without writing anything)
    await guardAccountSwitch("user-B");

    // Per-user data cleared.
    expect(storage.getItem(KEY_STREAK)).toBeNull();
    expect(storage.getItem(KEY_SETTINGS)).toBeNull();
    expect(storage.getItem(KEY_SETTINGS_LAST_PUSHED)).toBeNull();
  });

  it("writes a fresh SyncStatus with incomingUserId and null cursors when no archive was present", async () => {
    // restoreUserData mock does nothing - simulates no archive for user-B.
    saveSyncStatus({
      ...ZERO_STATUS,
      ownerUserId: "user-A",
      lastPullAt: "2026-05-01T10:00:00.000Z",
      lastSettingsPullAt: "2026-05-01T09:00:00.000Z",
    });

    await guardAccountSwitch("user-B");

    const after = loadSyncStatus();
    expect(after.ownerUserId).toBe("user-B");
    expect(after.lastPullAt).toBeNull();
    expect(after.lastSettingsPullAt).toBeNull();
    expect(after.lastSeenResetAt).toBeNull();
    expect(after.lastPushFailed).toBe(false);
    expect(after.structuralSyncError).toBeNull();
  });

  it("keeps archived SyncStatus cursors when restoreUserData populated them", async () => {
    // Simulate restoreUserData writing an archived SyncStatus for user-B.
    const archivedStatus: SyncStatus = {
      ...ZERO_STATUS,
      ownerUserId: "user-B",
      lastPullAt: "2026-04-15T08:00:00.000Z",
      lastSettingsPullAt: "2026-04-15T07:00:00.000Z",
    };
    mockRestore.mockImplementation(async () => {
      // Write the archived status as if restoreUserData had restored it.
      saveSyncStatus(archivedStatus);
    });

    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });

    await guardAccountSwitch("user-B");

    const after = loadSyncStatus();
    expect(after.ownerUserId).toBe("user-B");
    // Cursors from the archive should be preserved.
    expect(after.lastPullAt).toBe("2026-04-15T08:00:00.000Z");
    expect(after.lastSettingsPullAt).toBe("2026-04-15T07:00:00.000Z");
  });

  it("continues gracefully if archiveUserData throws (cloud is intact)", async () => {
    mockArchive.mockRejectedValueOnce(new Error("quota exceeded"));

    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });

    // Must not throw even if archive fails.
    await expect(guardAccountSwitch("user-B")).resolves.toBeUndefined();

    // Clear and restore still ran.
    expect(mockRestore).toHaveBeenCalledWith("user-B");
    expect(mockClearIdb).toHaveBeenCalled();
  });

  it("writes SyncStatus.ownerUserId = incomingUserId even after archive failure", async () => {
    mockArchive.mockRejectedValueOnce(new Error("quota exceeded"));
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });

    await guardAccountSwitch("user-B");

    const after = loadSyncStatus();
    expect(after.ownerUserId).toBe("user-B");
  });

  it("preserves device-level keys (superuser) across a switch", async () => {
    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A" });
    storage.setItem("poke-memory:superuser", "true");
    storage.setItem("poke-memory:superuser:flags:v1", JSON.stringify({ pretendAllMastered: true }));
    storage.setItem("poke-memory:last-seen-version:v1", "0.10.35");
    storage.setItem("poke-memory:pokedex-sort:v1", "alphabetical");

    await guardAccountSwitch("user-B");

    expect(storage.getItem("poke-memory:superuser")).toBe("true");
    expect(storage.getItem("poke-memory:superuser:flags:v1")).not.toBeNull();
    expect(storage.getItem("poke-memory:last-seen-version:v1")).toBe("0.10.35");
    expect(storage.getItem("poke-memory:pokedex-sort:v1")).toBe("alphabetical");
  });

  it("clears the sync-status key (it is a per-user key)", async () => {
    // Ensure restoreUserData is a no-op for this test (no archive for user-B).
    mockRestore.mockResolvedValueOnce(undefined);

    saveSyncStatus({ ...ZERO_STATUS, ownerUserId: "user-A", lastPullAt: "2026-05-01T10:00:00.000Z" });

    await guardAccountSwitch("user-B");

    // After the wipe + fresh status write, the ownerUserId must be user-B
    // and old cursors gone (no archive restored).
    const after = loadSyncStatus();
    expect(after.ownerUserId).toBe("user-B");
    expect(after.lastPullAt).toBeNull();
  });
});
