/**
 * Tests for the superuser cloud-write guard wiring.
 *
 * The guard lives at two sites today:
 *
 *  1. ReviewSession — passes null client/userId to usePerGradeSync and
 *     useSyncOnUnload when anyFlagOn is true.
 *  2. AutoSyncOnChange — short-circuits all push handlers when anyFlagOn is
 *     true (client and userId are both forced to null before the useEffect).
 *
 * These are logic-level tests: we assert that cloud-write hooks receive null
 * arguments when a superuser flag is on, using the same stub pattern that
 * AutoSyncOnChange.test.tsx and useSignInPull.test.tsx use.
 *
 * Out of scope: real Supabase sessions, OAuth redirects, or the content of
 * the superuser Developer panel UI.
 */

import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Shared fake auth objects
// ---------------------------------------------------------------------------

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = { id: "00000000-0000-0000-0000-000000000001" };

// ---------------------------------------------------------------------------
// Section 1 — AutoSyncOnChange short-circuit
// The established test file (AutoSyncOnChange.test.tsx) covers the happy path.
// Here we specifically assert that when anyFlagOn is true the push helpers are
// never called, regardless of which event fires.
// ---------------------------------------------------------------------------

vi.mock("@/lib/sync/persistence", () => ({
  markPushSucceeded: vi.fn(),
}));

vi.mock("@/lib/sync/settings", () => ({
  pushSettings: vi.fn(),
}));

vi.mock("@/lib/sync/streak", () => ({
  pushStreak: vi.fn(),
}));

vi.mock("@/lib/sync/gradeLog", () => ({
  pushGradeLog: vi.fn(),
}));

vi.mock("@/lib/streak/persistence", () => ({
  STREAK_UPDATED_EVENT: "poke-memory:streak-updated",
  loadStreakData: vi.fn(() => ["2026-05-14"]),
}));

vi.mock("@/lib/settings/lastPushedSnapshot", () => ({
  loadLastPushedSettings: vi.fn(() => null),
  saveLastPushedSettings: vi.fn(),
  diffSettings: vi.fn(
    (prev: Record<string, unknown> | null, next: Record<string, unknown>) =>
      prev === null ? next : next,
  ),
}));

// Auth: signed-in by default; tests override per scenario.
const mockUseAuth = vi.fn(() => ({
  user: FAKE_USER as ReturnType<typeof import("@/lib/auth/AuthContext").useAuth>["user"],
  supabase: FAKE_CLIENT,
}));
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

// Superuser: no flags on by default; overridden per test.
const mockUseSuperuser = vi.fn(() => ({ anyFlagOn: false }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

import { AutoSyncOnChange } from "@/components/sync/AutoSyncOnChange";
import { pushSettings } from "@/lib/sync/settings";
import { pushStreak } from "@/lib/sync/streak";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { STREAK_UPDATED_EVENT } from "@/lib/streak/persistence";
import { GRADE_LOG_APPENDED_EVENT } from "@/lib/gradelog/persistence";

describe("AutoSyncOnChange — superuser write guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pushSettings).mockResolvedValue(true);
    vi.mocked(pushStreak).mockResolvedValue(true);
    vi.mocked(pushGradeLog).mockResolvedValue(true);
    // Reset to signed-in, no flags.
    mockUseAuth.mockReturnValue({
      user: FAKE_USER as ReturnType<typeof import("@/lib/auth/AuthContext").useAuth>["user"],
      supabase: FAKE_CLIENT,
    });
    mockUseSuperuser.mockReturnValue({ anyFlagOn: false });
  });

  it("pushes settings when no flag is on (baseline)", () => {
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
    });

    expect(pushSettings).toHaveBeenCalledTimes(1);
  });

  it("suppresses settings push when anyFlagOn is true", () => {
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
    });

    expect(pushSettings).not.toHaveBeenCalled();
  });

  it("suppresses streak push when anyFlagOn is true", () => {
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });

    expect(pushStreak).not.toHaveBeenCalled();
  });

  it("suppresses grade log push when anyFlagOn is true", () => {
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });

    render(<AutoSyncOnChange />);

    const entry = {
      occurredAt: 1700000000000,
      date: "2026-05-14",
      grade: 4 as const,
      cardType: "name" as const,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: entry }),
      );
    });

    expect(pushGradeLog).not.toHaveBeenCalled();
  });

  it("suppresses all pushes even when the user is signed in with a valid client", () => {
    // The critical invariant: a signed-in QA session must not leak to the cloud.
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    // User is still "signed in" from the auth context perspective.
    mockUseAuth.mockReturnValue({
      user: FAKE_USER as ReturnType<typeof import("@/lib/auth/AuthContext").useAuth>["user"],
      supabase: FAKE_CLIENT,
    });

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, {
          detail: { occurredAt: 1, date: "2026-05-14", grade: 4, cardType: "name" },
        }),
      );
    });

    expect(pushSettings).not.toHaveBeenCalled();
    expect(pushStreak).not.toHaveBeenCalled();
    expect(pushGradeLog).not.toHaveBeenCalled();
  });

  it("resumes pushes after anyFlagOn transitions from true → false", () => {
    // Start with the flag on.
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    const { rerender } = render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
    });
    expect(pushSettings).not.toHaveBeenCalled();

    // Turn the flag off — the component re-renders and the effect re-runs.
    mockUseSuperuser.mockReturnValue({ anyFlagOn: false });
    rerender(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
    });

    expect(pushSettings).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — ReviewSession null client/userId guard
// We don't render the full ReviewSession (too many deps); we test the hook
// layer that ReviewSession delegates to — usePerGradeSync and useSyncOnUnload
// — which both accept null to short-circuit. This is a logic-level assertion:
// null inputs → no cloud writes.
// ---------------------------------------------------------------------------

// Re-mock the cloud module for the second describe block's hook tests.
vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(),
  isSyncSafe: vi.fn(() => true),
  buildBeaconPayload: vi.fn(() => null),
}));

import { renderHook } from "@testing-library/react";
import { usePerGradeSync } from "@/lib/sync/usePerGradeSync";
import { useSyncOnUnload } from "@/lib/sync/useSyncOnUnload";
import { pushSingleCard } from "@/lib/sync/cloud";

describe("usePerGradeSync — null guard (ReviewSession superuser path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pushSingleCard).mockResolvedValue(true);
  });

  it("does not push when client is null (flag on → syncClient = null)", async () => {
    // Simulate what ReviewSession does: superuserGuarded → null client.
    const { result } = renderHook(() => usePerGradeSync(null, FAKE_USER.id));

    await act(async () => {
      result.current.enqueueGrade({
        id: 1,
        speciesId: 1,
        isDefaultForm: true,
        formCategory: "default",
        formSlug: null,
        displayName: "Bulbasaur",
        cardType: "name",
        subjectKey: "1",
        name: "Bulbasaur",
        spriteUrl: "",
        types: ["grass"],
        stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
        flavorText: "",
        flavorTexts: [""],
        evolutionChain: [],
        height: 7,
        weight: 69,
        baseExperience: 64,
        genus: "Seed Pokémon",
        generation: "generation-i",
        captureRate: null,
        baseHappiness: null,
        growthRate: null,
        habitat: null,
        genderRate: null,
        isLegendary: false,
        isMythical: false,
        cryUrl: null,
        state: {
          stability: 1,
          difficulty: 0,
          elapsedDays: 0,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          fsrsState: "review",
          dueDate: "2026-05-14",
          lastReview: "2026-05-13",
          firstSeen: "2026-05-12",
          learningStep: null,
          stepStartedAt: null,
          hiddenSince: null,
          seenInPasture: false,
        },
      });
      // Let debounce fire.
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
  });

  it("does not push when userId is null (flag on → syncUserId = null)", async () => {
    // Simulate what ReviewSession does: superuserGuarded → null userId.
    const { result } = renderHook(() => usePerGradeSync(FAKE_CLIENT, null));

    await act(async () => {
      result.current.enqueueGrade({
        id: 2,
        speciesId: 2,
        isDefaultForm: true,
        formCategory: "default",
        formSlug: null,
        displayName: "Ivysaur",
        cardType: "name",
        subjectKey: "2",
        name: "Ivysaur",
        spriteUrl: "",
        types: ["grass"],
        stats: { hp: 60, attack: 62, defense: 63, specialAttack: 80, specialDefense: 80, speed: 60 },
        flavorText: "",
        flavorTexts: [""],
        evolutionChain: [],
        height: 10,
        weight: 130,
        baseExperience: 142,
        genus: "Seed Pokémon",
        generation: "generation-i",
        captureRate: null,
        baseHappiness: null,
        growthRate: null,
        habitat: null,
        genderRate: null,
        isLegendary: false,
        isMythical: false,
        cryUrl: null,
        state: {
          stability: 1,
          difficulty: 0,
          elapsedDays: 0,
          scheduledDays: 1,
          reps: 1,
          lapses: 0,
          fsrsState: "review",
          dueDate: "2026-05-14",
          lastReview: "2026-05-13",
          firstSeen: "2026-05-12",
          learningStep: null,
          stepStartedAt: null,
          hiddenSince: null,
          seenInPasture: false,
        },
      });
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(pushSingleCard).not.toHaveBeenCalled();
  });
});

describe("useSyncOnUnload — null guard (ReviewSession superuser path)", () => {
  it("does not register unload listeners when client is null", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const getUnsynced = vi.fn(() => []);

    renderHook(() => useSyncOnUnload(null, FAKE_USER.id, getUnsynced));

    // useSyncOnUnload adds visibilitychange and pagehide only when both client
    // and userId are non-null — verify neither is registered.
    const calls = addSpy.mock.calls.map(([ev]) => ev);
    expect(calls).not.toContain("visibilitychange");
    expect(calls).not.toContain("pagehide");

    addSpy.mockRestore();
  });

  it("does not register unload listeners when userId is null", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const getUnsynced = vi.fn(() => []);

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, null, getUnsynced));

    const calls = addSpy.mock.calls.map(([ev]) => ev);
    expect(calls).not.toContain("visibilitychange");
    expect(calls).not.toContain("pagehide");

    addSpy.mockRestore();
  });

  it("does register unload listeners when both client and userId are non-null", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const getUnsynced = vi.fn(() => []);

    renderHook(() => useSyncOnUnload(FAKE_CLIENT, FAKE_USER.id, getUnsynced));

    const calls = addSpy.mock.calls.map(([ev]) => ev);
    expect(calls).toContain("visibilitychange");
    expect(calls).toContain("pagehide");

    addSpy.mockRestore();
  });
});
