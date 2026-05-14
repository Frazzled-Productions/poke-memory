/**
 * Smoke test for the signed-in branch of `SuperuserProvider.exitCleanup` —
 * the QA-repudiate path that runs when the last superuser flag flips off
 * while the user is authenticated. Confirms all five tables are pulled and
 * applied, mirroring the Force-pull-all shape from #573.
 */

import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SuperuserProvider,
  useSuperuser,
} from "@/lib/superuser/SuperuserContext";

const { mockAuthValue } = vi.hoisted(() => ({
  mockAuthValue: {
    user: { id: "user-123", user_metadata: {} } as null | {
      id: string;
      user_metadata: Record<string, unknown>;
    },
    supabase: { auth: {} } as null | { auth: unknown },
    loading: false,
  },
}));

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockAuthValue,
}));

vi.mock("@/lib/sync/cloud", () => ({
  pullSession: vi.fn().mockResolvedValue([]),
  applyCloudAuthoritative: vi.fn(() => []),
  maxCloudUpdatedAt: vi.fn(() => "2026-05-14T12:00:00.000Z"),
}));

vi.mock("@/lib/sync/settings", () => ({
  pullSettingsWithTimestamp: vi.fn(),
  pullRegionalPrefs: vi.fn(),
}));

vi.mock("@/lib/sync/streak", () => ({
  pullStreak: vi.fn(),
}));

vi.mock("@/lib/sync/gradeLog", () => ({
  pullGradeLog: vi.fn(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
    lastSettingsPullAt: null,
    lastSeenResetAt: null,
  })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(async () => null),
  saveSession: vi.fn(async () => ({ ok: true })),
  STORAGE_KEY: "poke-memory:review-session:v1",
}));

vi.mock("@/lib/review/session", () => ({
  DEFAULT_LIMITS: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  },
}));

vi.mock("@/lib/review/seedOpts", () => ({
  seedOptsFromSettings: vi.fn(() => ({
    nameEnabled: true,
    evolutionEnabled: true,
    reverseEnabled: false,
    reverseEvolutionEnabled: false,
    cryEnabled: false,
  })),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({
    masteryRepetitions: 3,
    nameCardsEnabled: true,
  })),
  saveSettings: vi.fn(),
}));

vi.mock("@/lib/streak/persistence", () => ({
  saveStreakData: vi.fn(),
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  saveGradeLog: vi.fn(async () => {}),
}));

vi.mock("@/lib/theme/persistence", () => ({
  loadFavourite: vi.fn(() => null),
  saveFavourite: vi.fn(),
  isFavouriteEarned: vi.fn(() => false),
}));

vi.mock("@/lib/idb/db", () => ({
  idbDelete: vi.fn(async () => {}),
}));

vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
  SEED_EVOLUTION_CARDS: [],
}));

vi.mock("@/lib/superuser/persistence", () => ({
  isUnlocked: vi.fn(() => false),
  setUnlocked: vi.fn(),
  loadFlags: vi.fn(() => ({ pretendAllMastered: true })),
  saveFlags: vi.fn(),
  clearFlags: vi.fn(),
  anyFlagTrue: (f: Record<string, boolean>) => Object.values(f).some(Boolean),
  UNLOCKED_KEY: "poke-memory:superuser:unlocked:v1",
  FLAGS_KEY: "poke-memory:superuser:flags:v1",
  DEFAULT_FLAGS: { pretendAllMastered: false },
}));

function Harness({ onReady }: { onReady: (api: ReturnType<typeof useSuperuser>) => void }) {
  const api = useSuperuser();
  return (
    <button
      type="button"
      onClick={() => onReady(api)}
    >
      ready
    </button>
  );
}

describe("SuperuserProvider.exitCleanup — signed-in branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthValue.user = { id: "user-123", user_metadata: {} };
    mockAuthValue.supabase = { auth: {} };
  });

  it("pulls all five tables and applies them cloud-authoritative when the last flag flips off", async () => {
    const { pullSession, applyCloudAuthoritative } = await import(
      "@/lib/sync/cloud"
    );
    const { pullSettingsWithTimestamp, pullRegionalPrefs } = await import(
      "@/lib/sync/settings"
    );
    const { pullStreak } = await import("@/lib/sync/streak");
    const { pullGradeLog } = await import("@/lib/sync/gradeLog");
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const { saveGradeLog } = await import("@/lib/gradelog/persistence");
    const { saveSettings } = await import("@/lib/settings/persistence");
    const { saveSyncStatus } = await import("@/lib/sync/persistence");

    vi.mocked(pullSession).mockResolvedValueOnce([]);
    vi.mocked(applyCloudAuthoritative).mockReturnValue([]);
    vi.mocked(pullSettingsWithTimestamp).mockResolvedValueOnce({
      settings: { masteryRepetitions: 5 } as never,
      updatedAt: "2026-05-14T10:00:00.000Z",
    });
    vi.mocked(pullRegionalPrefs).mockResolvedValueOnce({
      timezone: "Europe/London",
      dateFormat: "dmy",
    });
    vi.mocked(pullStreak).mockResolvedValueOnce(["2026-05-13", "2026-05-14"]);
    vi.mocked(pullGradeLog).mockResolvedValueOnce([
      { occurredAt: 1, date: "2026-05-14", cardType: "name", grade: 4 },
    ]);

    let api!: ReturnType<typeof useSuperuser>;
    render(
      <SuperuserProvider>
        <Harness onReady={(a) => (api = a)} />
      </SuperuserProvider>,
    );
    // Force a render where useSuperuser delivers the current context value.
    const buttons = document.querySelectorAll("button");
    buttons[0].click();

    // Flip the only flag off — triggers exitCleanup.
    await act(async () => {
      await api.setFlag("pretendAllMastered", false);
    });

    expect(pullSession).toHaveBeenCalledWith(expect.anything(), "user-123");
    expect(pullSettingsWithTimestamp).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
    );
    expect(pullRegionalPrefs).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
    );
    expect(pullStreak).toHaveBeenCalledWith(expect.anything(), "user-123");
    expect(pullGradeLog).toHaveBeenCalledWith(expect.anything(), "user-123");
    expect(saveSettings).toHaveBeenCalled();
    expect(saveStreakData).toHaveBeenCalledWith(["2026-05-13", "2026-05-14"]);
    expect(saveGradeLog).toHaveBeenCalledWith([
      { occurredAt: 1, date: "2026-05-14", cardType: "name", grade: 4 },
    ]);
    expect(saveSyncStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        lastPullAt: "2026-05-14T12:00:00.000Z",
        lastSettingsPullAt: "2026-05-14T10:00:00.000Z",
      }),
    );
  });

  it("does not run cleanup when pullSession returns null", async () => {
    const { pullSession } = await import("@/lib/sync/cloud");
    const { saveStreakData } = await import("@/lib/streak/persistence");
    const { saveGradeLog } = await import("@/lib/gradelog/persistence");

    vi.mocked(pullSession).mockResolvedValueOnce(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    let api!: ReturnType<typeof useSuperuser>;
    render(
      <SuperuserProvider>
        <Harness onReady={(a) => (api = a)} />
      </SuperuserProvider>,
    );
    document.querySelectorAll("button")[0].click();

    await act(async () => {
      await api.setFlag("pretendAllMastered", false);
    });

    expect(saveStreakData).not.toHaveBeenCalled();
    expect(saveGradeLog).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
