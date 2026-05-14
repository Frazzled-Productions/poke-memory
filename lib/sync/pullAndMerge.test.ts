import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pullAndMerge } from "./pullAndMerge";
import { pullSession, mergeCloudIntoLocalSilent } from "@/lib/sync/cloud";
import { pullSettingsWithTimestamp } from "@/lib/sync/settings";
import { pullStreak } from "@/lib/sync/streak";
import { pullGradeLog } from "@/lib/sync/gradeLog";
import { saveSession, loadSession } from "@/lib/review/persistence";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { buildSession } from "@/lib/review/session";
import { hasStoredSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings/persistence";
import { loadStreakData, saveStreakData } from "@/lib/streak/persistence";
import { loadGradeLog, saveGradeLog } from "@/lib/gradelog/persistence";

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(),
  mergeCloudIntoLocalSilent: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => "2026-05-13T12:00:00.000Z"),
}));

vi.mock("@/lib/sync/settings", () => ({
  pullSettingsWithTimestamp: vi.fn(),
  pullRegionalPrefs: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({ lastPullAt: null, lastSettingsPullAt: null })),
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

vi.mock("@/lib/sync/streak", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/streak")>(
    "@/lib/sync/streak",
  );
  return {
    ...actual,
    pullStreak: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/lib/streak/persistence", () => ({
  loadStreakData: vi.fn(() => []),
  saveStreakData: vi.fn(),
  STREAK_UPDATED_EVENT: "poke-memory:streak-updated",
}));

vi.mock("@/lib/sync/gradeLog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sync/gradeLog")>(
    "@/lib/sync/gradeLog",
  );
  return {
    ...actual,
    pullGradeLog: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn(async () => []),
  saveGradeLog: vi.fn(async () => {}),
}));

const mockPullSession = vi.mocked(pullSession);
const mockPullSettingsWithTimestamp = vi.mocked(pullSettingsWithTimestamp);
const mockPullStreak = vi.mocked(pullStreak);
const mockPullGradeLog = vi.mocked(pullGradeLog);
const mockLoadGradeLog = vi.mocked(loadGradeLog);
const mockSaveGradeLog = vi.mocked(saveGradeLog);
const mockMerge = vi.mocked(mergeCloudIntoLocalSilent);
const mockSaveSession = vi.mocked(saveSession);
const mockLoadSession = vi.mocked(loadSession);
const mockLoadSyncStatus = vi.mocked(loadSyncStatus);
const mockSaveSyncStatus = vi.mocked(saveSyncStatus);
const mockBuildSession = vi.mocked(buildSession);
const mockHasStoredSettings = vi.mocked(hasStoredSettings);
const mockLoadSettings = vi.mocked(loadSettings);
const mockSaveSettings = vi.mocked(saveSettings);
const mockLoadStreakData = vi.mocked(loadStreakData);
const mockSaveStreakData = vi.mocked(saveStreakData);

const fakeClient = {} as Parameters<typeof pullAndMerge>[0];
const fakeUserId = "user-123";

const baseSyncStatus = {
  lastPushAt: null,
  lastPushFailed: false,
  lastPushAttemptAt: null,
  failedCardCount: null,
  lastPullAt: null,
  lastSettingsPullAt: null,
};

describe("pullAndMerge", () => {
  beforeEach(() => {
    mockPullSession.mockResolvedValue([]);
    mockPullSettingsWithTimestamp.mockResolvedValue(null);
    mockPullStreak.mockResolvedValue(null);
    mockMerge.mockReturnValue([]);
    mockSaveSession.mockResolvedValue({ ok: true });
    mockLoadSession.mockResolvedValue(null);
    mockLoadSyncStatus.mockReturnValue({ ...baseSyncStatus });
    mockBuildSession.mockReturnValue([]);
    mockHasStoredSettings.mockReturnValue(false);
    mockLoadSettings.mockReturnValue({
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseCardsEnabled: false,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: false,
    } as ReturnType<typeof loadSettings>);
    mockLoadStreakData.mockReturnValue([]);
    mockPullGradeLog.mockResolvedValue(null);
    mockLoadGradeLog.mockResolvedValue([]);
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
    mockPullSettingsWithTimestamp.mockResolvedValue({
      settings: {
        nameCardsEnabled: true,
        evolutionCardsEnabled: true,
        reverseCardsEnabled: true,
        reverseEvolutionCardsEnabled: false,
        cryCardsEnabled: true,
      } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T11:00:00.000Z",
    });
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
    expect(mockPullSettingsWithTimestamp).toHaveBeenCalledOnce();
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

  // #572: settings pull now runs every cycle, not just on brand-new devices.
  // Devices with stored settings get cloud writes when the server-side
  // updated_at is strictly newer than the last copy this device applied.
  it("pulls and applies cloud settings when cloud is newer than lastSettingsPullAt", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSettingsPullAt: "2026-05-12T08:00:00.000Z",
    });
    mockPullSettingsWithTimestamp.mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        themeIntensity: "tinted",
      } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T12:00:00.000Z",
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullSettingsWithTimestamp).toHaveBeenCalledOnce();
    expect(mockSaveSettings).toHaveBeenCalledOnce();
    expect(mockSaveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastSettingsPullAt: "2026-05-13T12:00:00.000Z" }),
    );
  });

  it("does not apply cloud settings when cloud updated_at equals lastSettingsPullAt", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSettingsPullAt: "2026-05-13T12:00:00.000Z",
    });
    mockPullSettingsWithTimestamp.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T12:00:00.000Z",
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullSettingsWithTimestamp).toHaveBeenCalledOnce();
    expect(mockSaveSettings).not.toHaveBeenCalled();
    // The cursor is still advanced to the latest-seen timestamp so subsequent
    // pulls do not waste effort re-checking the same row.
    expect(mockSaveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastSettingsPullAt: "2026-05-13T12:00:00.000Z" }),
    );
  });

  // Guards the strict `>` semantic specifically — a `>=` regression would
  // wrongly apply cloud here even though the cursor is ahead.
  it("does not apply cloud settings when cloud updated_at is strictly older than lastSettingsPullAt", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSettingsPullAt: "2026-05-13T12:00:00.000Z",
    });
    mockPullSettingsWithTimestamp.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T10:00:00.000Z",
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  // Legacy rows (pre-dating updated_at population) have updatedAt === null.
  // The first pull must apply the cloud blob and stamp a synthetic cursor so
  // subsequent pulls don't re-apply a blob they cannot compare for freshness.
  it("applies legacy cloud settings (updatedAt null) when cursor has never been set", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({ ...baseSyncStatus, lastSettingsPullAt: null });
    mockPullSettingsWithTimestamp.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: null,
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockSaveSettings).toHaveBeenCalledOnce();
    // Cursor must advance to a non-null synthetic timestamp.
    expect(mockSaveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastSettingsPullAt: expect.any(String) }),
    );
    const saved = mockSaveSyncStatus.mock.calls[0][0] as { lastSettingsPullAt: string | null };
    expect(saved.lastSettingsPullAt).not.toBeNull();
  });

  it("does not re-apply legacy cloud settings when cursor already exists", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSettingsPullAt: "2026-05-10T00:00:00.000Z",
    });
    mockPullSettingsWithTimestamp.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: null,
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockSaveSettings).not.toHaveBeenCalled();
    // Cursor must not move — there is no real timestamp to advance to.
    expect(mockSaveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastSettingsPullAt: "2026-05-10T00:00:00.000Z" }),
    );
  });

  it("does not throw when settings pull fails — sync stays 'ok'", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockPullSettingsWithTimestamp.mockRejectedValue(new Error("network blip"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // ─── streak pull (#574) ───────────────────────────────────────────────────
  // STREAK_UPDATED_EVENT dispatch sits behind `typeof window !== "undefined"`
  // and so is only reachable from jsdom tests. The node-project tests here
  // cover the saveStreakData contract.

  it("union-merges cloud streak dates into local when cloud has new dates", async () => {
    mockLoadStreakData.mockReturnValue(["2026-05-11"]);
    mockPullStreak.mockResolvedValue(["2026-05-12", "2026-05-13"]);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullStreak).toHaveBeenCalledOnce();
    expect(mockSaveStreakData).toHaveBeenCalledWith([
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
    ]);
  });

  it("does not write when cloud streak is a subset of local", async () => {
    mockLoadStreakData.mockReturnValue(["2026-05-11", "2026-05-12", "2026-05-13"]);
    mockPullStreak.mockResolvedValue(["2026-05-12"]);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullStreak).toHaveBeenCalledOnce();
    expect(mockSaveStreakData).not.toHaveBeenCalled();
  });

  it("does not throw when streak pull fails — sync stays 'ok'", async () => {
    mockPullStreak.mockRejectedValue(new Error("network blip"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not touch local streak when pullStreak returns null", async () => {
    mockLoadStreakData.mockReturnValue(["2026-05-11"]);
    mockPullStreak.mockResolvedValue(null);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockSaveStreakData).not.toHaveBeenCalled();
  });

  // ─── grade_log pull (#575) ────────────────────────────────────────────────

  it("union-merges cloud grade-log entries into local when cloud has new occurredAts", async () => {
    mockLoadGradeLog.mockResolvedValue([
      { occurredAt: 1000, date: "2026-05-12", cardType: "name", grade: 4 },
    ]);
    mockPullGradeLog.mockResolvedValue([
      { occurredAt: 1000, date: "2026-05-12", cardType: "name", grade: 4 },
      { occurredAt: 2000, date: "2026-05-13", cardType: "name", grade: 5 },
    ]);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullGradeLog).toHaveBeenCalledOnce();
    expect(mockSaveGradeLog).toHaveBeenCalledOnce();
    const written = mockSaveGradeLog.mock.calls[0][0];
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.occurredAt)).toEqual([1000, 2000]);
  });

  it("union-merges when each side has unique entries the other lacks", async () => {
    mockLoadGradeLog.mockResolvedValue([
      { occurredAt: 1000, date: "2026-05-12", cardType: "name", grade: 4 },
      { occurredAt: 2000, date: "2026-05-13", cardType: "name", grade: 5 },
    ]);
    mockPullGradeLog.mockResolvedValue([
      { occurredAt: 1500, date: "2026-05-12", cardType: "name", grade: 2 },
      { occurredAt: 3000, date: "2026-05-13", cardType: "name", grade: 4 },
    ]);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockSaveGradeLog).toHaveBeenCalledOnce();
    const written = mockSaveGradeLog.mock.calls[0][0];
    expect(written.map((e) => e.occurredAt)).toEqual([1000, 1500, 2000, 3000]);
  });

  it("does not write when cloud grade-log is a subset of local", async () => {
    mockLoadGradeLog.mockResolvedValue([
      { occurredAt: 1000, date: "2026-05-12", cardType: "name", grade: 4 },
      { occurredAt: 2000, date: "2026-05-13", cardType: "name", grade: 5 },
    ]);
    mockPullGradeLog.mockResolvedValue([
      { occurredAt: 1000, date: "2026-05-12", cardType: "name", grade: 4 },
    ]);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullGradeLog).toHaveBeenCalledOnce();
    expect(mockSaveGradeLog).not.toHaveBeenCalled();
  });

  it("does not throw when grade-log pull fails — sync stays 'ok'", async () => {
    mockPullGradeLog.mockRejectedValue(new Error("network blip"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pullAndMerge(fakeClient, fakeUserId);

    expect(result).toBe("ok");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not touch local grade-log when pullGradeLog returns null", async () => {
    mockLoadGradeLog.mockResolvedValue([
      { occurredAt: 1000, date: "2026-05-12", cardType: "name", grade: 4 },
    ]);
    mockPullGradeLog.mockResolvedValue(null);

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockSaveGradeLog).not.toHaveBeenCalled();
  });
});
