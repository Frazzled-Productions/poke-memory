import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AutoSyncOnChange } from "@/components/sync/AutoSyncOnChange";

// Superuser context: default to no flags on. Tests that exercise the write-guard
// can override anyFlagOn via vi.mocked(useSuperuser).mockReturnValue(...).
const mockUseSuperuser = vi.fn(() => ({
  unlocked: false,
  flags: { pretendAllMastered: false },
  anyFlagOn: false,
  setFlag: vi.fn(),
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  markPushSucceeded: vi.fn(),
}));

// Auth: a signed-in fake. Tests can override by re-mocking inside an `it`.
const FAKE_CLIENT = {} as unknown as SupabaseClient;
const FAKE_USER = { id: "00000000-0000-0000-0000-000000000000" };

vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({ user: FAKE_USER, supabase: FAKE_CLIENT })),
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
  loadStreakData: vi.fn(() => ["2026-05-12"]),
}));

vi.mock("@/lib/settings/lastPushedSnapshot", () => ({
  loadLastPushedSettings: vi.fn(() => null),
  saveLastPushedSettings: vi.fn(),
  // Real diff: snapshot null → return full object; otherwise top-level diff.
  diffSettings: vi.fn((prev: Record<string, unknown> | null, next: Record<string, unknown>) => {
    if (prev === null) return next;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(next)) {
      if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
        patch[key] = next[key];
      }
    }
    return patch;
  }),
}));

import { useAuth } from "@/lib/auth/AuthContext";
import { pushSettings } from "@/lib/sync/settings";
import { pushStreak } from "@/lib/sync/streak";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import { markPushSucceeded } from "@/lib/sync/persistence";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import {
  STREAK_UPDATED_EVENT,
  loadStreakData,
} from "@/lib/streak/persistence";
import { GRADE_LOG_APPENDED_EVENT } from "@/lib/gradelog/persistence";

describe("AutoSyncOnChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default to signed-in with no superuser flags active.
    vi.mocked(useAuth).mockReturnValue({
      user: FAKE_USER as unknown as ReturnType<typeof useAuth>["user"],
      supabase: FAKE_CLIENT,
    } as ReturnType<typeof useAuth>);
    mockUseSuperuser.mockReturnValue({
      unlocked: false,
      flags: { pretendAllMastered: false },
      anyFlagOn: false,
      setFlag: vi.fn(),
    });
    vi.mocked(pushSettings).mockResolvedValue(true);
    vi.mocked(pushStreak).mockResolvedValue(true);
    vi.mocked(pushGradeLog).mockResolvedValue(true);
    vi.mocked(loadStreakData).mockReturnValue(["2026-05-12"]);
  });

  it("pushes settings when SETTINGS_SAVED_EVENT fires", () => {
    render(<AutoSyncOnChange />);

    const settings = { masteryRepetitions: 5 } as unknown as Parameters<
      typeof pushSettings
    >[2];

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: settings }),
      );
    });

    expect(pushSettings).toHaveBeenCalledTimes(1);
    expect(pushSettings).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER.id, settings);
  });

  it("pushes the union of streak dates when STREAK_UPDATED_EVENT fires", () => {
    vi.mocked(loadStreakData).mockReturnValue(["2026-05-10", "2026-05-12"]);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });

    expect(pushStreak).toHaveBeenCalledTimes(1);
    expect(pushStreak).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER.id, [
      "2026-05-10",
      "2026-05-12",
    ]);
  });

  it("does not push streak when loadStreakData returns []", () => {
    vi.mocked(loadStreakData).mockReturnValue([]);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });

    expect(pushStreak).not.toHaveBeenCalled();
  });

  it("pushes the single entry when GRADE_LOG_APPENDED_EVENT fires", () => {
    render(<AutoSyncOnChange />);

    const entry = {
      occurredAt: 1700000000000,
      date: "2026-05-12",
      grade: 4 as const,
      cardType: "name" as const,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: entry }),
      );
    });

    expect(pushGradeLog).toHaveBeenCalledTimes(1);
    expect(pushGradeLog).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER.id, [entry]);
  });

  it("does not push anything when signed out (user is null)", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      supabase: FAKE_CLIENT,
    } as ReturnType<typeof useAuth>);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: {} }),
      );
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: {} }),
      );
    });

    expect(pushSettings).not.toHaveBeenCalled();
    expect(pushStreak).not.toHaveBeenCalled();
    expect(pushGradeLog).not.toHaveBeenCalled();
  });

  it("swallows push failures without throwing", async () => {
    vi.mocked(pushSettings).mockResolvedValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 3 } }),
      );
    });

    // Give the microtask queue a chance to drain
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("calls markPushSucceeded when settings push succeeds", async () => {
    vi.mocked(pushSettings).mockResolvedValue(true);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 3 } }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });

  it("does not call markPushSucceeded when settings push fails", async () => {
    vi.mocked(pushSettings).mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 3 } }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });

  // ─── settings diff push (#583) ────────────────────────────────────────────

  it("pushes only the diff against the last-pushed snapshot", async () => {
    const { loadLastPushedSettings, saveLastPushedSettings } = await import(
      "@/lib/settings/lastPushedSnapshot"
    );
    vi.mocked(loadLastPushedSettings).mockReturnValue({
      masteryRepetitions: 3,
      themeIntensity: "accents",
    } as never);
    vi.mocked(pushSettings).mockResolvedValue(true);

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, {
          detail: {
            masteryRepetitions: 3, // unchanged
            themeIntensity: "tinted", // changed
          },
        }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    // Only the changed key is in the patch.
    expect(pushSettings).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER.id, {
      themeIntensity: "tinted",
    });
    // Snapshot stamped to the FULL detail (not the patch) so the next diff
    // is computed against what cloud now holds.
    expect(saveLastPushedSettings).toHaveBeenCalledWith({
      masteryRepetitions: 3,
      themeIntensity: "tinted",
    });
  });

  it("skips the push entirely when the diff is empty", async () => {
    const { loadLastPushedSettings } = await import(
      "@/lib/settings/lastPushedSnapshot"
    );
    vi.mocked(loadLastPushedSettings).mockReturnValue({
      masteryRepetitions: 3,
    } as never);

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, {
          detail: { masteryRepetitions: 3 },
        }),
      );
    });

    await Promise.resolve();

    expect(pushSettings).not.toHaveBeenCalled();
  });

  it("does not update the snapshot when the push fails", async () => {
    const { loadLastPushedSettings, saveLastPushedSettings } = await import(
      "@/lib/settings/lastPushedSnapshot"
    );
    vi.mocked(loadLastPushedSettings).mockReturnValue({
      masteryRepetitions: 3,
    } as never);
    vi.mocked(pushSettings).mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, {
          detail: { masteryRepetitions: 5 },
        }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(saveLastPushedSettings).not.toHaveBeenCalled();
  });

  it("calls markPushSucceeded when streak push succeeds", async () => {
    vi.mocked(pushStreak).mockResolvedValue(true);
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });

  it("does not call markPushSucceeded when streak push fails", async () => {
    vi.mocked(pushStreak).mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });

  it("calls markPushSucceeded when grade log push succeeds", async () => {
    vi.mocked(pushGradeLog).mockResolvedValue(true);
    render(<AutoSyncOnChange />);

    const entry = {
      occurredAt: 1700000000000,
      date: "2026-05-13",
      grade: 4 as const,
      cardType: "name" as const,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: entry }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).toHaveBeenCalledTimes(1);
  });

  it("does not call markPushSucceeded when grade log push fails", async () => {
    vi.mocked(pushGradeLog).mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<AutoSyncOnChange />);

    const entry = {
      occurredAt: 1700000000000,
      date: "2026-05-13",
      grade: 4 as const,
      cardType: "name" as const,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: entry }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });
});

// ─── Superuser write-guard (#754) ─────────────────────────────────────────────
//
// When any superuser flag is active, AutoSyncOnChange must treat the user as
// signed out — client and userId are nulled out — so no cloud writes occur even
// though auth credentials are present. This mirrors the guard in
// ReviewSession.tsx that passes null to usePerGradeSync / useSyncOnUnload.

describe("AutoSyncOnChange — superuser write-guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Signed-in user — credentials are valid. The guard must kick in despite this.
    vi.mocked(useAuth).mockReturnValue({
      user: FAKE_USER as unknown as ReturnType<typeof useAuth>["user"],
      supabase: FAKE_CLIENT,
    } as ReturnType<typeof useAuth>);
    // Activate a superuser flag so anyFlagOn is true.
    mockUseSuperuser.mockReturnValue({
      unlocked: true,
      flags: { pretendAllMastered: true },
      anyFlagOn: true,
      setFlag: vi.fn(),
    });
    vi.mocked(pushSettings).mockResolvedValue(true);
    vi.mocked(pushStreak).mockResolvedValue(true);
    vi.mocked(pushGradeLog).mockResolvedValue(true);
    vi.mocked(loadStreakData).mockReturnValue(["2026-05-12"]);
  });

  it("does not push settings when a superuser flag is active", () => {
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
    });

    expect(pushSettings).not.toHaveBeenCalled();
  });

  it("does not push streak when a superuser flag is active", () => {
    render(<AutoSyncOnChange />);

    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });

    expect(pushStreak).not.toHaveBeenCalled();
  });

  it("does not push grade log when a superuser flag is active", () => {
    render(<AutoSyncOnChange />);

    const entry = {
      occurredAt: 1700000000000,
      date: "2026-05-12",
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

  it("does not call markPushSucceeded on any event when a superuser flag is active", async () => {
    render(<AutoSyncOnChange />);

    const entry = {
      occurredAt: 1700000000000,
      date: "2026-05-12",
      grade: 4 as const,
      cardType: "name" as const,
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: { masteryRepetitions: 5 } }),
      );
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
      window.dispatchEvent(
        new CustomEvent(GRADE_LOG_APPENDED_EVENT, { detail: entry }),
      );
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(markPushSucceeded)).not.toHaveBeenCalled();
  });
});
