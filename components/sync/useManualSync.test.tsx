import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useManualSync } from "@/lib/sync/useManualSync";

// Mock the network layer. The merge function is left unmocked so the test
// proves the real merge sees pulled cloud rows before the push happens.
vi.mock("@/lib/sync/cloud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sync/cloud")>();
  return {
    ...actual,
    pullSession: vi.fn(),
    pushSession: vi.fn(),
  };
});

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadSyncStatus: vi.fn(() => ({
    lastPushAt: null,
    lastPushFailed: false,
    lastPushAttemptAt: null,
    failedCardCount: null,
    lastPullAt: null,
  })),
  saveSyncStatus: vi.fn(),
}));

vi.mock("@/lib/sync/streak", () => ({
  pullStreak: vi.fn(),
  pushStreak: vi.fn(),
  mergeStreak: (a: string[], b: string[]) =>
    Array.from(new Set([...a, ...b])).sort(),
}));

vi.mock("@/lib/sync/settings", () => ({
  pullSettings: vi.fn(),
  pushSettings: vi.fn(),
}));

vi.mock("@/lib/streak/persistence", () => ({
  loadStreakData: vi.fn(() => []),
  saveStreakData: vi.fn(),
  STREAK_UPDATED_EVENT: "poke-memory:streak-updated",
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({})),
  saveSettings: vi.fn(),
  hasStoredSettings: vi.fn(() => false),
}));

vi.mock("@/lib/sync/gradeLog", () => ({
  pullGradeLog: vi.fn(),
  pushGradeLog: vi.fn(),
  mergeGradeLog: (a: unknown[], b: unknown[]) => [...a, ...b],
}));

vi.mock("@/lib/gradelog/persistence", () => ({
  loadGradeLog: vi.fn(() => []),
  saveGradeLog: vi.fn(),
}));

vi.mock("@/lib/review/session", () => ({
  buildSession: vi.fn(() => []),
  DEFAULT_LIMITS: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  },
}));

import { pullSession, pushSession } from "@/lib/sync/cloud";
import { loadSyncStatus, saveSyncStatus } from "@/lib/sync/persistence";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { pullStreak, pushStreak } from "@/lib/sync/streak";
import { pullSettings, pushSettings } from "@/lib/sync/settings";
import { loadStreakData, saveStreakData } from "@/lib/streak/persistence";
import { hasStoredSettings, loadSettings, saveSettings } from "@/lib/settings/persistence";
import { pullGradeLog, pushGradeLog } from "@/lib/sync/gradeLog";
import { loadGradeLog } from "@/lib/gradelog/persistence";
import { buildSession, DEFAULT_LIMITS } from "@/lib/review/session";

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";

function makeCard(id: number, lastReview: string | null, reps: number) {
  return {
    id,
    cardType: "name" as const,
    name: `pokemon-${id}`,
    spriteUrl: "",
    types: ["normal"],
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: "",
    generation: "generation-i" as const,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    state: {
      stability: reps === 0 ? 0 : 1,
      difficulty: 0,
      elapsedDays: 0,
      scheduledDays: reps === 0 ? 0 : 1,
      reps,
      lapses: 0,
      fsrsState: (reps === 0 ? "new" : "review") as "new" | "review",
      dueDate: "2026-05-12",
      lastReview,
      firstSeen: lastReview,
      learningStep: null,
      stepStartedAt: null,
      hiddenSince: null,
      seenInPasture: false,
    },
  };
}

describe("useManualSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveSession).mockReturnValue({ ok: true });
    // Default streak/settings behaviour: cloud is empty, local is empty, all
    // pushes succeed. Individual tests override these as needed.
    vi.mocked(pullStreak).mockResolvedValue([]);
    vi.mocked(pushStreak).mockResolvedValue(true);
    vi.mocked(pullSettings).mockResolvedValue(null);
    vi.mocked(pushSettings).mockResolvedValue(true);
    vi.mocked(loadStreakData).mockReturnValue([]);
    vi.mocked(hasStoredSettings).mockReturnValue(false);
    vi.mocked(loadSettings).mockReturnValue({} as ReturnType<typeof loadSettings>);
    vi.mocked(pullGradeLog).mockResolvedValue([]);
    vi.mocked(pushGradeLog).mockResolvedValue(true);
    vi.mocked(loadGradeLog).mockReturnValue([]);
  });

  // Regression test for #293: a previous version pushed BEFORE pulling, so a
  // stale or emptied local session could clobber real cloud progress via the
  // (user_id, pokemon_id) upsert key.
  it("pulls cloud rows before pushing local state", async () => {
    const order: string[] = [];

    vi.mocked(loadSession).mockReturnValue({
      cards: [makeCard(1, "2026-05-10", 3)],
      limits: DEFAULT_LIMITS,
    });

    vi.mocked(pullSession).mockImplementation(async () => {
      order.push("pull");
      return [];
    });

    vi.mocked(pushSession).mockImplementation(async () => {
      order.push("push");
      return true;
    });

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    expect(order).toEqual(["pull", "push"]);
    expect(pullSession).toHaveBeenCalledTimes(1);
    expect(pushSession).toHaveBeenCalledTimes(1);
  });

  // Brand-new device: localStorage is empty. Pull succeeds, the result is
  // saved locally, and we MUST NOT push back — there is no local-only state
  // to upload, and pushing an entirely cloud-sourced session is a wasteful
  // round trip that also widens the window for a future bug to regress data.
  it("skips push on brand-new device (no local session)", async () => {
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(pullSession).mockResolvedValue([]);
    vi.mocked(pushSession).mockResolvedValue(true);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    expect(pullSession).toHaveBeenCalledTimes(1);
    expect(pushSession).not.toHaveBeenCalled();
  });

  // #294: streak should union-merge local and cloud days, save the merge
  // locally, and push the merged set back so any local-only days reach cloud.
  it("union-merges streak: pulls cloud, merges with local, saves, pushes back", async () => {
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(pullSession).mockResolvedValue([]);
    vi.mocked(loadStreakData).mockReturnValue(["2026-05-10", "2026-05-11"]);
    vi.mocked(pullStreak).mockResolvedValue(["2026-05-11", "2026-05-12"]);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    // saveStreakData receives the union, sorted, deduped.
    expect(saveStreakData).toHaveBeenCalledWith([
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
    ]);
    expect(pushStreak).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, [
      "2026-05-10",
      "2026-05-11",
      "2026-05-12",
    ]);
  });

  // #294: settings — when no local settings have been stored (e.g. fresh
  // device after logout/login), the cloud value overlays local. Local
  // settings (defaults) are NOT pushed over the cloud's real values.
  it("settings: pulls cloud and overlays local when no local has been stored", async () => {
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(pullSession).mockResolvedValue([]);
    vi.mocked(hasStoredSettings).mockReturnValue(false);
    const cloudSettings = { masteryRepetitions: 7, maxNewPerDay: 5 } as ReturnType<
      typeof loadSettings
    >;
    vi.mocked(pullSettings).mockResolvedValue(cloudSettings);
    vi.mocked(loadSettings).mockReturnValueOnce({} as ReturnType<typeof loadSettings>);
    // After saveSettings is called with cloudSettings, the next loadSettings
    // returns the cloud value, which is what gets pushed back.
    vi.mocked(loadSettings).mockReturnValue(cloudSettings);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    expect(saveSettings).toHaveBeenCalledWith(cloudSettings);
    expect(pushSettings).toHaveBeenCalled();
  });

  // #294: when the user already has local settings (the common case), we
  // never overlay cloud onto local — local is authoritative — but we do
  // push local up so the cloud gets the latest.
  it("settings: keeps local when stored, pushes local up", async () => {
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(pullSession).mockResolvedValue([]);
    vi.mocked(hasStoredSettings).mockReturnValue(true);
    const localSettings = { masteryRepetitions: 3, maxNewPerDay: 20 } as ReturnType<
      typeof loadSettings
    >;
    vi.mocked(loadSettings).mockReturnValue(localSettings);
    vi.mocked(pullSettings).mockResolvedValue({ masteryRepetitions: 99 } as ReturnType<
      typeof loadSettings
    >);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    // saveSettings is NEVER called: local is authoritative when present.
    expect(saveSettings).not.toHaveBeenCalled();
    // Local is pushed up so cloud catches up.
    expect(pushSettings).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER, localSettings);
  });

  // #294: streak/settings failures are best-effort — they must NOT flip the
  // sync into the error state. Cards are the primary contract; auxiliary
  // sync hiccups should leave the user with a "success" state and a logged
  // warning.
  it("does not enter error state when streak/settings pull or push fails", async () => {
    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(pullSession).mockResolvedValue([]);
    vi.mocked(pullStreak).mockResolvedValue(null);
    vi.mocked(pushStreak).mockResolvedValue(false);
    vi.mocked(pullSettings).mockResolvedValue(null);
    vi.mocked(pushSettings).mockResolvedValue(false);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });
  });

  // If the pull fails, we MUST NOT push. Pushing without first knowing what's
  // in the cloud is the exact failure mode that caused #293.
  it("does not push when pull fails", async () => {
    vi.mocked(loadSession).mockReturnValue({
      cards: [makeCard(1, "2026-05-10", 3)],
      limits: DEFAULT_LIMITS,
    });
    vi.mocked(pullSession).mockResolvedValue(null);
    vi.mocked(pushSession).mockResolvedValue(true);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("error");
    });

    expect(pushSession).not.toHaveBeenCalled();
  });

  // Regression test for #359: a previous version never wrote lastPullAt from
  // the manual-sync success block. That left lastPullAt = null for users who
  // sync only via the Stats button, and the subsequent background pullAndMerge
  // would clobber today's local progress under the "no anchor → cloud wins"
  // rule (the same defect now also corrected in mergeCloudIntoLocalSilent).
  it("persists lastPullAt from the server-derived max updated_at on success", async () => {
    vi.mocked(loadSession).mockReturnValue({
      cards: [makeCard(1, "2026-05-12", 3)],
      limits: DEFAULT_LIMITS,
    });
    vi.mocked(pullSession).mockResolvedValue([
      {
        pokemon_id: 1,
        stability: 1,
        difficulty: 1,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 1,
        lapses: 0,
        fsrs_state: "review",
        due_date: "2026-05-13",
        last_review: "2026-05-12",
        first_seen: "2026-05-12",
        hidden_since: null,
        seen_in_pasture: false,
        updated_at: "2026-05-13T09:15:00.000Z",
      },
      {
        pokemon_id: 2,
        stability: 1,
        difficulty: 1,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 1,
        lapses: 0,
        fsrs_state: "review",
        due_date: "2026-05-13",
        last_review: "2026-05-12",
        first_seen: "2026-05-12",
        hidden_since: null,
        seen_in_pasture: false,
        updated_at: "2026-05-13T11:42:00.000Z",
      },
    ]);
    vi.mocked(pushSession).mockResolvedValue(true);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    // The success-block saveSyncStatus call is the last one made by the run.
    const successCall = vi
      .mocked(saveSyncStatus)
      .mock.calls.at(-1)?.[0];
    expect(successCall).toMatchObject({
      lastPushFailed: false,
      lastPullAt: "2026-05-13T11:42:00.000Z",
    });
  });

  // Regression test for #367: manual sync used to call mergeCloudIntoLocal
  // (unconditional cloud overlay) which silently clobbered local progress when
  // cloud was stale. The user-initiated Sync button is a reconcile, not a
  // force-overwrite — local grades since the last anchored pull must survive.
  it("does not clobber local progress when cloud is stale and lastPullAt is set", async () => {
    vi.mocked(loadSyncStatus).mockReturnValue({
      lastPushAt: null,
      lastPushFailed: false,
      lastPushAttemptAt: null,
      failedCardCount: null,
      lastPullAt: "2026-05-12T08:00:00.000Z",
    });
    vi.mocked(loadSession).mockReturnValue({
      cards: [makeCard(1, "2026-05-13", 5)],
      limits: DEFAULT_LIMITS,
    });
    vi.mocked(pullSession).mockResolvedValue([
      {
        pokemon_id: 1,
        stability: 1,
        difficulty: 1,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 1,
        lapses: 0,
        fsrs_state: "review",
        due_date: "2026-05-13",
        last_review: "2026-05-11",
        first_seen: "2026-05-11",
        hidden_since: null,
        seen_in_pasture: false,
        updated_at: "2026-05-12T07:00:00.000Z",
      },
    ]);
    vi.mocked(pushSession).mockResolvedValue(true);

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    // The saved session must keep local's lastReview = "2026-05-13", not be
    // overwritten by cloud's "2026-05-11".
    const savedCall = vi.mocked(saveSession).mock.calls[0]?.[0];
    expect(savedCall?.cards[0].state.lastReview).toBe("2026-05-13");
    expect(savedCall?.cards[0].state.reps).toBe(5);
  });

  // #391: a brand-new device with no local settings stored must pull cloud
  // settings and save them before the merge step builds the base — otherwise
  // the seed defaults (reverse/cry disabled) silently drop cloud rows for
  // those types when the merge iterates over local cards.
  it("brand-new device pulls and saves cloud settings before merging cards", async () => {
    const order: string[] = [];

    const cloudSettings = {
      nameCardsEnabled: true,
      evolutionCardsEnabled: true,
      reverseCardsEnabled: true,
      reverseEvolutionCardsEnabled: false,
      cryCardsEnabled: true,
    } as ReturnType<typeof loadSettings>;

    vi.mocked(loadSession).mockReturnValue(null);
    vi.mocked(pullSession).mockResolvedValue([]);
    vi.mocked(hasStoredSettings).mockReturnValue(false);
    vi.mocked(pullSettings).mockImplementation(async () => {
      order.push("pull-settings");
      return cloudSettings;
    });
    vi.mocked(saveSettings).mockImplementation((settings) => {
      order.push("save-settings");
      // Simulate the real saveSettings writing to storage so that the
      // subsequent loadSettings() call returns the pulled cloud values.
      vi.mocked(loadSettings).mockReturnValue(settings as ReturnType<typeof loadSettings>);
    });
    vi.mocked(saveSession).mockImplementation(() => {
      order.push("save-session");
      return { ok: true };
    });

    const { result } = renderHook(() => useManualSync(FAKE_CLIENT, FAKE_USER));

    act(() => {
      result.current.syncNow();
    });

    await waitFor(() => {
      expect(result.current.syncState).toBe("success");
    });

    // saveSettings must run before saveSession (which persists the merged
    // base built from the just-pulled settings).
    const settingsSaveIdx = order.indexOf("save-settings");
    const sessionSaveIdx = order.indexOf("save-session");
    expect(settingsSaveIdx).toBeGreaterThan(-1);
    expect(sessionSaveIdx).toBeGreaterThan(-1);
    expect(sessionSaveIdx).toBeGreaterThan(settingsSaveIdx);

    // buildSession must receive the reverse/cry-enabled opts from cloud.
    // A regression where loadSettings() is read before saveSettings() writes
    // the pulled values would cause reverseEnabled/cryEnabled to be undefined
    // (DEFAULT_SETTINGS has them off), and this assertion would fail.
    expect(buildSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({ reverseEnabled: true, cryEnabled: true }),
    );
  });
});
