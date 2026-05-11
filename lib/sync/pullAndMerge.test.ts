import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pullAndMerge } from "./pullAndMerge";

// Mock modules used by pullAndMerge so the test doesn't need real Supabase
// or a seeded localStorage.
vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(),
  mergeCloudIntoLocalSilent: vi.fn((_local: unknown, _cloud: unknown) => []),
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

async function getCloudMock() {
  const m = await import("@/lib/sync/cloud");
  return m as unknown as { pullSession: ReturnType<typeof vi.fn>; mergeCloudIntoLocalSilent: ReturnType<typeof vi.fn> };
}

async function getSaveMock() {
  const m = await import("@/lib/review/persistence");
  return m as unknown as { loadSession: ReturnType<typeof vi.fn>; saveSession: ReturnType<typeof vi.fn> };
}

const fakeClient = {} as Parameters<typeof pullAndMerge>[0];
const fakeUserId = "user-123";

describe("pullAndMerge", () => {
  let dispatchedEvents: StorageEvent[];

  beforeEach(() => {
    dispatchedEvents = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => { dispatchedEvents.push(e as StorageEvent); },
      localStorage: {
        getItem: () => null,
      },
    });
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
    const { pullSession } = await getCloudMock();
    pullSession.mockResolvedValue(null);

    expect(await pullAndMerge(fakeClient, fakeUserId)).toBe("error");
  });

  it('returns "error" and fires no StorageEvent when saveSession returns { ok: false }', async () => {
    const { pullSession } = await getCloudMock();
    const { saveSession } = await getSaveMock();

    pullSession.mockResolvedValue([]);
    saveSession.mockReturnValue({ ok: false, reason: "quota" });

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("error");
    expect(dispatchedEvents).toHaveLength(0);
  });

  it('returns "ok" and dispatches StorageEvent when save succeeds', async () => {
    const { pullSession } = await getCloudMock();
    const { saveSession } = await getSaveMock();

    pullSession.mockResolvedValue([]);
    saveSession.mockReturnValue({ ok: true });

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0].key).toBe("poke-memory:review-session:v1");
  });
});
