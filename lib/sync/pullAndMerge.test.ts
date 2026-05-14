import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pullAndMerge } from "./pullAndMerge";
import { pullSession, mergeCloudIntoLocalSilent } from "@/lib/sync/cloud";
import { pullSettings } from "@/lib/sync/settings";
import { saveSession, loadSession } from "@/lib/review/persistence";
import { saveSyncStatus } from "@/lib/sync/persistence";
import { buildSession } from "@/lib/review/session";
import { hasStoredSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings/persistence";

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(),
  mergeCloudIntoLocalSilent: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => "2026-05-13T12:00:00.000Z"),
}));

vi.mock("@/lib/sync/settings", () => ({
  pullSettings: vi.fn(),
  pullRegionalPrefs: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({ lastPullAt: null })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(async () => null),
  saveSession: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/review/session", () => ({
  buildSession: vi.fn(() => []),
  DEFAULT_LIMITS: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  },
}));

vi.mock("@/lib/settings/persistence", () => ({
  hasStoredSettings: vi.fn(() => false),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  DEFAULT_SETTINGS: {
    nameCardsEnabled: true,
    evolutionCardsEnabled: true,
    reverseCardsEnabled: false,
    reverseEvolutionCardsEnabled: false,
    cryCardsEnabled: false,
  },
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
}));

const mockPullSession = vi.mocked(pullSession);
const mockPullSettings = vi.mocked(pullSettings);
const mockMerge = vi.mocked(mergeCloudIntoLocalSilent);
const mockSaveSession = vi.mocked(saveSession);
const mockLoadSession = vi.mocked(loadSession);
const mockSaveSyncStatus = vi.mocked(saveSyncStatus);
const mockBuildSession = vi.mocked(buildSession);
const mockHasStoredSettings = vi.mocked(hasStoredSettings);
const mockLoadSettings = vi.mocked(loadSettings);
const mockSaveSettings = vi.mocked(saveSettings);

const fakeClient = {} as Parameters<typeof pullAndMerge>[0];
const fakeUserId = "user-123";

describe("pullAndMerge", () => {
  beforeEach(() => {
    mockPullSession.mockResolvedValue([]);
    mockPullSettings.mockResolvedValue(null);
    mockMerge.mockReturnValue([]);
    mockSaveSession.mockResolvedValue({ ok: true });
    mockLoadSession.mockResolvedValue(null);
    mockBuildSession.mockReturnValue([]);
    mockHasStoredSettings.mockReturnValue(false);
    mockLoadSettings.mockReturnValue({
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: false,
    } as ReturnType<typeof loadSettings>);
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
    mockSaveSession.mockResolvedValue({ ok: false, reason: "quota" });

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

  // #391: when local has no stored settings and cloud has settings with
  // reverse/cry enabled, the brand-new-device base must include those types
  // — otherwise their cloud rows are silently dropped by the merge.
  it("pulls cloud settings before building base when local has no settings stored", async () => {
    mockHasStoredSettings.mockReturnValue(false);
    mockPullSettings.mockResolvedValue({
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: true,
    } as ReturnType<typeof loadSettings>);
    // After settings pull, loadSettings reflects the pulled values.
    mockLoadSettings.mockReturnValue({
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: true,
    } as ReturnType<typeof loadSettings>);

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(mockPullSettings).toHaveBeenCalledOnce();
    expect(mockSaveSettings).toHaveBeenCalledOnce();
    // buildSession must receive the reverse/cry-enabled opts from cloud.
    expect(mockBuildSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        reverseEnabled: true,
        cryEnabled: true,
      }),
    );
  });

  it("does not pull settings when local already has them stored", async () => {
    mockHasStoredSettings.mockReturnValue(true);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullSettings).not.toHaveBeenCalled();
  });
});
