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
  loadSyncStatus: vi.fn(() => ({})),
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

import { pullSession, pushSession } from "@/lib/sync/cloud";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { pullStreak, pushStreak } from "@/lib/sync/streak";
import { pullSettings, pushSettings } from "@/lib/sync/settings";
import { loadStreakData, saveStreakData } from "@/lib/streak/persistence";
import { hasStoredSettings, loadSettings, saveSettings } from "@/lib/settings/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = "00000000-0000-0000-0000-000000000000";

function makeCard(id: number, lastReview: string | null, repetitions: number) {
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
      repetitions,
      interval: repetitions === 0 ? 0 : 1,
      easeFactor: 2.5,
      dueDate: "2026-05-12",
      lastReview,
      firstSeen: lastReview,
      learningStep: null,
      stepStartedAt: null,
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
});
