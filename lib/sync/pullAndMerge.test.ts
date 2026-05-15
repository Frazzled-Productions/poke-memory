import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pullAndMerge, SYNC_PULL_APPLIED_EVENT } from "./pullAndMerge";
import { pullSession, mergeCloudIntoLocalSilent } from "@/lib/sync/cloud";
import { pullUserSettingsRow } from "@/lib/sync/settings";
import { pullStreak } from "@/lib/sync/streak";
import { pullGradeLog } from "@/lib/sync/gradeLog";
import { saveSession, loadSession } from "@/lib/review/persistence";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { buildSession } from "@/lib/review/session";
import { hasStoredSettings, loadSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/settings/persistence";
import { loadStreakData, saveStreakData } from "@/lib/streak/persistence";
import { loadGradeLog, saveGradeLog } from "@/lib/gradelog/persistence";
import { clearLocalProgress } from "@/lib/storage/reset";

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn(),
  mergeCloudIntoLocalSilent: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => "2026-05-13T12:00:00.000Z"),
}));

vi.mock("@/lib/sync/settings", () => ({
  pullUserSettingsRow: vi.fn(),
  pullRegionalPrefs: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/storage/reset", () => ({
  clearLocalProgress: vi.fn(async () => {}),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({ lastPullAt: null, lastSettingsPullAt: null })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(async () => null),
  saveSession: vi.fn(async () => ({ ok: true })),
  bumpSessionStorageKey: vi.fn(),
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
const mockPullUserSettingsRow = vi.mocked(pullUserSettingsRow);
const mockClearLocalProgress = vi.mocked(clearLocalProgress);
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
    lastSeenResetAt: null,
};

describe("pullAndMerge", () => {
  beforeEach(() => {
    mockPullSession.mockResolvedValue([]);
    mockPullUserSettingsRow.mockResolvedValue(null);
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
    mockPullUserSettingsRow.mockResolvedValue({
      settings: {
        nameCardsEnabled: true,
        evolutionCardsEnabled: true,
        reverseCardsEnabled: true,
        reverseEvolutionCardsEnabled: false,
        cryCardsEnabled: true,
      } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T11:00:00.000Z", lastResetAt: null,
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
    expect(mockPullUserSettingsRow).toHaveBeenCalledOnce();
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
    mockPullUserSettingsRow.mockResolvedValue({
      settings: {
        ...DEFAULT_SETTINGS,
        themeIntensity: "tinted",
      } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T12:00:00.000Z", lastResetAt: null,
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullUserSettingsRow).toHaveBeenCalledOnce();
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
    mockPullUserSettingsRow.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T12:00:00.000Z", lastResetAt: null,
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockPullUserSettingsRow).toHaveBeenCalledOnce();
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
    mockPullUserSettingsRow.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: "2026-05-13T10:00:00.000Z", lastResetAt: null,
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
    mockPullUserSettingsRow.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: null, lastResetAt: null,
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
    mockPullUserSettingsRow.mockResolvedValue({
      settings: { ...DEFAULT_SETTINGS } as ReturnType<typeof loadSettings>,
      updatedAt: null, lastResetAt: null,
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
    mockPullUserSettingsRow.mockRejectedValue(new Error("network blip"));
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

  // ─── tombstone / last_reset_at (#576) ─────────────────────────────────────
  // Cloud advancing user_settings.last_reset_at past the local
  // lastSeenResetAt cursor means another device called reset_all_progress.
  // We wipe local before merging so stale local rows do not survive into
  // the merged session and resurrect deleted rows.

  it("clears local progress when cloud last_reset_at is newer than local cursor", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSeenResetAt: "2026-05-12T10:00:00.000Z",
    });
    mockPullUserSettingsRow.mockResolvedValue({
      settings: null,
      updatedAt: null,
      lastResetAt: "2026-05-13T15:00:00.000Z",
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockClearLocalProgress).toHaveBeenCalledOnce();
    expect(mockSaveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({ lastSeenResetAt: "2026-05-13T15:00:00.000Z" }),
    );
  });

  it("does NOT clear local when cloud last_reset_at equals local cursor", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSeenResetAt: "2026-05-13T15:00:00.000Z",
    });
    mockPullUserSettingsRow.mockResolvedValue({
      settings: null,
      updatedAt: null,
      lastResetAt: "2026-05-13T15:00:00.000Z",
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockClearLocalProgress).not.toHaveBeenCalled();
  });

  it("clears local on first-ever sight of a reset (local cursor null)", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({
      ...baseSyncStatus,
      lastSeenResetAt: null,
    });
    mockPullUserSettingsRow.mockResolvedValue({
      settings: null,
      updatedAt: null,
      lastResetAt: "2026-05-13T15:00:00.000Z",
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockClearLocalProgress).toHaveBeenCalledOnce();
  });

  it("does NOT clear local when cloud has no reset on record (lastResetAt null)", async () => {
    mockHasStoredSettings.mockReturnValue(true);
    mockLoadSyncStatus.mockReturnValue({ ...baseSyncStatus });
    mockPullUserSettingsRow.mockResolvedValue({
      settings: null,
      updatedAt: null,
      lastResetAt: null,
    });

    await pullAndMerge(fakeClient, fakeUserId);

    expect(mockClearLocalProgress).not.toHaveBeenCalled();
  });

  // ─── SYNC_PULL_APPLIED_EVENT dispatch (#608) ──────────────────────────────
  // The dispatch is gated on both `wasColdLoad` (localSession was null before
  // the merge) and `mergeAffectsProgress`. These tests stub `window` so the
  // node-environment guard (`typeof window !== "undefined"`) is satisfied.

  describe("SYNC_PULL_APPLIED_EVENT", () => {
    // Minimal card shape needed by mergeAffectsProgress
    function card(id: string, lastReview: string | null, firstSeen: string | null) {
      return { id, state: { lastReview, firstSeen } };
    }

    // Stub window + CustomEvent before each test in this block; unstub after.
    let mockDispatch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockDispatch = vi.fn();
      vi.stubGlobal("window", { dispatchEvent: mockDispatch });
      // CustomEvent may not be defined in the node test environment.
      vi.stubGlobal(
        "CustomEvent",
        class {
          type: string;
          constructor(type: string, _init?: unknown) {
            this.type = type;
          }
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fires when cold load + merge advances a card's lastReview", async () => {
      mockLoadSession.mockResolvedValue(null);
      mockBuildSession.mockReturnValue([card("pikachu", null, null)] as any);
      mockMerge.mockReturnValue([card("pikachu", "2026-05-14", "2026-05-10")] as any);

      await pullAndMerge(fakeClient, fakeUserId);

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch.mock.calls[0][0]).toMatchObject({ type: SYNC_PULL_APPLIED_EVENT });
    });

    it("stays silent on cold load when merge is a no-op (cloud matches seed)", async () => {
      mockLoadSession.mockResolvedValue(null);
      mockBuildSession.mockReturnValue([card("pikachu", null, null)] as any);
      mockMerge.mockReturnValue([card("pikachu", null, null)] as any);

      await pullAndMerge(fakeClient, fakeUserId);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("stays silent when local session already exists (not a cold load)", async () => {
      // Non-cold load: user already has local review state
      mockLoadSession.mockResolvedValue({
        cards: [card("pikachu", "2026-05-13", "2026-05-01")] as any,
        limits: {} as any,
      });
      // Cloud brings newer lastReview — mergeAffectsProgress would return true,
      // so suppression must come from wasColdLoad, not from the no-op check.
      mockMerge.mockReturnValue([card("pikachu", "2026-05-14", "2026-05-01")] as any);

      await pullAndMerge(fakeClient, fakeUserId);

      expect(mockDispatch).not.toHaveBeenCalled();
      // buildSession is only called on the cold-load path; asserting it was not
      // called proves wasColdLoad was false, not that mergeAffectsProgress happened
      // to return false on incidentally empty arrays.
      expect(mockBuildSession).not.toHaveBeenCalled();
    });

    // Real-world cold-load race (#608): ReviewSession's mount-time load() writes
    // a fresh pristine session via IDB (fast) before pullAndMerge's network
    // pullSession returns, so loadSession() inside pullAndMerge sees a non-null
    // but pristine localSession rather than null. Without treating pristine as
    // a cold load, the dispatch never fires for the canonical PWA bug.
    it("fires when local session is non-null but pristine (race with ReviewSession.load)", async () => {
      mockLoadSession.mockResolvedValue({
        cards: [card("pikachu", null, null)] as any,
        limits: {} as any,
      });
      mockMerge.mockReturnValue([card("pikachu", "2026-05-14", "2026-05-10")] as any);

      await pullAndMerge(fakeClient, fakeUserId);

      expect(mockDispatch).toHaveBeenCalledOnce();
      expect(mockDispatch.mock.calls[0][0]).toMatchObject({ type: SYNC_PULL_APPLIED_EVENT });
    });

    it("stays silent when local session is pristine but merge is a no-op", async () => {
      mockLoadSession.mockResolvedValue({
        cards: [card("pikachu", null, null)] as any,
        limits: {} as any,
      });
      mockMerge.mockReturnValue([card("pikachu", null, null)] as any);

      await pullAndMerge(fakeClient, fakeUserId);

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
