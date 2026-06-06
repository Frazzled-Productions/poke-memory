/**
 * Unit tests for lib/storage/userArchive.ts (#1712).
 *
 * Exercises archiveUserData, restoreUserData, and clearIdbPendingQueue with
 * mocked IDB (idbGet/idbSet/idbDelete) and a fake localStorage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock IDB (async, called inside archiveUserData / restoreUserData) ────────

const mockIdbGet = vi.fn((_key: string): Promise<string | null> => Promise.resolve(null));
const mockIdbSet = vi.fn((_key: string, _val: string): Promise<void> => Promise.resolve());
const mockIdbDelete = vi.fn((_key: string): Promise<void> => Promise.resolve());

vi.mock("@/lib/idb/db", () => ({
  idbGet: (key: string) => mockIdbGet(key),
  idbSet: (key: string, val: string) => mockIdbSet(key, val),
  idbDelete: (key: string) => mockIdbDelete(key),
}));

// ─── Fake localStorage ────────────────────────────────────────────────────────

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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  archiveUserData,
  restoreUserData,
  clearIdbPendingQueue,
} from "./userArchive";
import {
  KEY_STREAK,
  KEY_SYNC_STATUS,
  KEY_SETTINGS,
  KEY_SETTINGS_LAST_PUSHED,
  KEY_DAILY_SUMMARY,
  KEY_HAS_MASTERED,
  KEY_GRADE_LOG,
  KEY_REVIEW_SESSION,
  KEY_PENDING_GRADE_QUEUE,
  userArchiveKey,
} from "./keys";

const MT_PREFIX = "poke-memory:mt-banner-dismissed";
const USER_A = "user-aaa-111";
const USER_B = "user-bbb-222";

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  storage = makeMockStorage();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("StorageEvent", class {
    key: string | null;
    constructor(_: string, init: { key?: string } = {}) { this.key = init.key ?? null; }
  });
  mockIdbGet.mockClear();
  mockIdbSet.mockClear();
  mockIdbDelete.mockClear();
  // Default: IDB has no data.
  mockIdbGet.mockResolvedValue(null);
  mockIdbSet.mockResolvedValue(undefined);
  mockIdbDelete.mockResolvedValue(undefined);
});

// ─── archiveUserData ──────────────────────────────────────────────────────────

describe("archiveUserData", () => {
  it("is a no-op when window is undefined (SSR)", async () => {
    vi.unstubAllGlobals();
    await expect(archiveUserData(USER_A)).resolves.toBeUndefined();
  });

  it("writes a blob under the user-archive key when LS has data", async () => {
    storage.setItem(KEY_STREAK, JSON.stringify(["2026-05-20"]));
    storage.setItem(KEY_SETTINGS, JSON.stringify({ timezone: "Europe/London" }));
    storage.setItem(KEY_SYNC_STATUS, JSON.stringify({ ownerUserId: USER_A }));

    await archiveUserData(USER_A);

    const archiveRaw = storage.getItem(userArchiveKey(USER_A));
    expect(archiveRaw, "archive blob must be written").not.toBeNull();

    const blob = JSON.parse(archiveRaw!) as { v: number; ls: Record<string, string>; idb: Record<string, string> };
    expect(blob.v).toBe(1);
    expect(blob.ls[KEY_STREAK]).toBe(JSON.stringify(["2026-05-20"]));
    expect(blob.ls[KEY_SETTINGS]).toBe(JSON.stringify({ timezone: "Europe/London" }));
    expect(blob.ls[KEY_SYNC_STATUS]).toBe(JSON.stringify({ ownerUserId: USER_A }));
  });

  it("does not include keys absent from LS", async () => {
    // Only write streak - daily-summary, etc. absent.
    storage.setItem(KEY_STREAK, "[]");

    await archiveUserData(USER_A);

    const blob = JSON.parse(storage.getItem(userArchiveKey(USER_A))!) as { ls: Record<string, string> };
    expect(blob.ls[KEY_DAILY_SUMMARY]).toBeUndefined();
    expect(blob.ls[KEY_HAS_MASTERED]).toBeUndefined();
  });

  it("includes mt-banner-dismissed keys scanned by prefix", async () => {
    storage.setItem(`${MT_PREFIX}:ja`, "true");
    storage.setItem(`${MT_PREFIX}:zh-Hans`, "true");

    await archiveUserData(USER_A);

    const blob = JSON.parse(storage.getItem(userArchiveKey(USER_A))!) as { ls: Record<string, string> };
    expect(blob.ls[`${MT_PREFIX}:ja`]).toBe("true");
    expect(blob.ls[`${MT_PREFIX}:zh-Hans`]).toBe("true");
  });

  it("snapshots IDB keys that are present", async () => {
    mockIdbGet.mockImplementation(async (key: string) => {
      if (key === KEY_REVIEW_SESSION) return '{"cards":[]}';
      if (key === KEY_GRADE_LOG) return '[]';
      return null;
    });

    await archiveUserData(USER_A);

    const blob = JSON.parse(storage.getItem(userArchiveKey(USER_A))!) as { idb: Record<string, string> };
    expect(blob.idb[KEY_REVIEW_SESSION]).toBe('{"cards":[]}');
    expect(blob.idb[KEY_GRADE_LOG]).toBe('[]');
    // Absent IDB key must not appear.
    expect(blob.idb[KEY_PENDING_GRADE_QUEUE]).toBeUndefined();
  });

  it("does not include IDB keys that are absent (null)", async () => {
    mockIdbGet.mockResolvedValue(null);

    await archiveUserData(USER_A);

    const blob = JSON.parse(storage.getItem(userArchiveKey(USER_A))!) as { idb: Record<string, string> };
    expect(Object.keys(blob.idb)).toHaveLength(0);
  });

  it("swallows quota errors (non-fatal)", async () => {
    // Simulate setItem throwing a QuotaExceededError.
    storage.setItem = (_key: string, _val: string) => { throw new Error("QuotaExceededError"); };

    await expect(archiveUserData(USER_A)).resolves.toBeUndefined();
  });
});

// ─── restoreUserData ──────────────────────────────────────────────────────────

describe("restoreUserData", () => {
  it("is a no-op when window is undefined (SSR)", async () => {
    vi.unstubAllGlobals();
    await expect(restoreUserData(USER_B)).resolves.toBeUndefined();
  });

  it("is a no-op when no archive exists for the user", async () => {
    const before = storage.length;
    await restoreUserData(USER_B);
    expect(storage.length).toBe(before);
  });

  it("restores LS keys from the archive blob", async () => {
    // Write an archive manually.
    const blob = {
      v: 1,
      ls: {
        [KEY_STREAK]: JSON.stringify(["2026-05-20"]),
        [KEY_SETTINGS]: JSON.stringify({ timezone: "Asia/Tokyo" }),
        [KEY_SETTINGS_LAST_PUSHED]: JSON.stringify({}),
      },
      idb: {},
    };
    storage.setItem(userArchiveKey(USER_B), JSON.stringify(blob));

    await restoreUserData(USER_B);

    expect(storage.getItem(KEY_STREAK)).toBe(JSON.stringify(["2026-05-20"]));
    expect(storage.getItem(KEY_SETTINGS)).toBe(JSON.stringify({ timezone: "Asia/Tokyo" }));
  });

  it("restores IDB keys from the archive blob", async () => {
    const blob = {
      v: 1,
      ls: {},
      idb: {
        [KEY_REVIEW_SESSION]: '{"cards":[{"id":1}]}',
        [KEY_GRADE_LOG]: '[{"grade":4}]',
      },
    };
    storage.setItem(userArchiveKey(USER_B), JSON.stringify(blob));

    await restoreUserData(USER_B);

    expect(mockIdbSet).toHaveBeenCalledWith(KEY_REVIEW_SESSION, '{"cards":[{"id":1}]}');
    expect(mockIdbSet).toHaveBeenCalledWith(KEY_GRADE_LOG, '[{"grade":4}]');
  });

  it("removes the archive blob after restore (consumed)", async () => {
    const blob = { v: 1, ls: { [KEY_STREAK]: "[]" }, idb: {} };
    storage.setItem(userArchiveKey(USER_B), JSON.stringify(blob));

    await restoreUserData(USER_B);

    expect(storage.getItem(userArchiveKey(USER_B))).toBeNull();
  });

  it("dispatches StorageEvents for KEY_REVIEW_SESSION and KEY_GRADE_LOG after restore", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent });

    const blob = { v: 1, ls: { [KEY_STREAK]: "[]" }, idb: {} };
    storage.setItem(userArchiveKey(USER_B), JSON.stringify(blob));

    await restoreUserData(USER_B);

    const keys = dispatchEvent.mock.calls.map((c) => (c[0] as { key: string | null }).key);
    expect(keys).toContain(KEY_REVIEW_SESSION);
    expect(keys).toContain(KEY_GRADE_LOG);
  });

  it("ignores a malformed archive blob (non-fatal)", async () => {
    storage.setItem(userArchiveKey(USER_B), "not-valid-json");
    await expect(restoreUserData(USER_B)).resolves.toBeUndefined();
  });

  it("ignores an archive blob with wrong version tag", async () => {
    const blob = { v: 99, ls: { [KEY_STREAK]: "[]" }, idb: {} };
    storage.setItem(userArchiveKey(USER_B), JSON.stringify(blob));
    const before = storage.getItem(KEY_STREAK);
    await restoreUserData(USER_B);
    expect(storage.getItem(KEY_STREAK)).toBe(before); // unchanged
  });
});

// ─── clearIdbPendingQueue ─────────────────────────────────────────────────────

describe("clearIdbPendingQueue", () => {
  it("calls idbDelete on the pending-grade-queue key", async () => {
    await clearIdbPendingQueue();
    expect(mockIdbDelete).toHaveBeenCalledWith(KEY_PENDING_GRADE_QUEUE);
  });
});
