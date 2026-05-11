import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pullAndMerge } from "./pullAndMerge";
import { pullSession, mergeCloudIntoLocalSilent } from "@/lib/sync/cloud";
import { saveSession, loadSession } from "@/lib/review/persistence";

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(),
  mergeCloudIntoLocalSilent: vi.fn(() => []),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({ lastPullAt: null })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(() => null),
  saveSession: vi.fn(() => ({ ok: true })),
}));

vi.mock("@/lib/review/session", () => ({
  buildSession: vi.fn(() => []),
  DEFAULT_LIMITS: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  },
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
}));

const mockPullSession = vi.mocked(pullSession);
const mockMerge = vi.mocked(mergeCloudIntoLocalSilent);
const mockSaveSession = vi.mocked(saveSession);
const mockLoadSession = vi.mocked(loadSession);

const fakeClient = {} as Parameters<typeof pullAndMerge>[0];
const fakeUserId = "user-123";

describe("pullAndMerge", () => {
  let dispatchedEvents: StorageEvent[];

  beforeEach(() => {
    dispatchedEvents = [];
    // StorageEvent is a browser API unavailable in the node test environment.
    // Stub it so pullAndMerge can construct and dispatch events without throwing.
    vi.stubGlobal(
      "StorageEvent",
      class {
        key: string | null;
        constructor(_type: string, init: { key?: string | null } = {}) {
          this.key = init.key ?? null;
        }
      },
    );
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => { dispatchedEvents.push(e as StorageEvent); },
      localStorage: { getItem: () => null },
    });
    // Reset to success defaults before each test.
    mockPullSession.mockResolvedValue([]);
    mockMerge.mockReturnValue([]);
    mockSaveSession.mockReturnValue({ ok: true });
    mockLoadSession.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns "skipped" when called without client or userId', async () => {
    expect(await pullAndMerge(null, null)).toBe("skipped");
    expect(await pullAndMerge(fakeClient, null)).toBe("skipped");
    expect(await pullAndMerge(null, fakeUserId)).toBe("skipped");
  });

  it('returns "error" when pullSession returns null', async () => {
    mockPullSession.mockResolvedValue(null);
    expect(await pullAndMerge(fakeClient, fakeUserId)).toBe("error");
  });

  it('returns "error" and fires no StorageEvent when saveSession returns { ok: false }', async () => {
    mockSaveSession.mockReturnValue({ ok: false, reason: "quota" });

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("error");
    expect(dispatchedEvents).toHaveLength(0);
  });

  it('returns "ok" and dispatches StorageEvent when save succeeds', async () => {
    // mockSaveSession already returns { ok: true } from beforeEach.
    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0].key).toBe("poke-memory:review-session:v1");
  });
});
