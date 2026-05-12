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

import { pullSession, pushSession } from "@/lib/sync/cloud";
import { loadSession, saveSession } from "@/lib/review/persistence";
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
