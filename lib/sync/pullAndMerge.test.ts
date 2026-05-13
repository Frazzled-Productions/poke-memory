import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pullAndMerge } from "./pullAndMerge";
import { pullSession, mergeCloudIntoLocalSilent } from "@/lib/sync/cloud";
import { saveSession, loadSession } from "@/lib/review/persistence";
import { saveSyncStatus } from "@/lib/sync/persistence";

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(),
  mergeCloudIntoLocalSilent: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => "2026-05-13T12:00:00.000Z"),
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
const mockSaveSyncStatus = vi.mocked(saveSyncStatus);

const fakeClient = {} as Parameters<typeof pullAndMerge>[0];
const fakeUserId = "user-123";

describe("pullAndMerge", () => {
  beforeEach(() => {
    mockPullSession.mockResolvedValue([]);
    mockMerge.mockReturnValue([]);
    mockSaveSession.mockReturnValue({ ok: true });
    mockLoadSession.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  it('returns "error" and does not advance lastPullAt when saveSession fails', async () => {
    mockSaveSession.mockReturnValue({ ok: false, reason: "quota" });

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("error");
    // Subscribers must not be notified of state that was never written —
    // saveSession's own dispatch is gated on a successful setItem, and
    // saveSyncStatus must not advance the cursor either.
    expect(mockSaveSyncStatus).not.toHaveBeenCalled();
  });

  it('returns "ok" and persists when save succeeds', async () => {
    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(mockSaveSession).toHaveBeenCalledOnce();
    // The synthetic StorageEvent dispatch is now saveSession's responsibility
    // (covered by persistence.test.ts) — pullAndMerge just has to call it.
    expect(mockSaveSyncStatus).toHaveBeenCalledOnce();
  });
});
