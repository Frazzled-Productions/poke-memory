import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AutoSyncOnChange } from "@/components/sync/AutoSyncOnChange";

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

import { useAuth } from "@/lib/auth/AuthContext";
import { pushSettings } from "@/lib/sync/settings";
import { pushStreak } from "@/lib/sync/streak";
import { pushGradeLog } from "@/lib/sync/gradeLog";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import {
  STREAK_UPDATED_EVENT,
  loadStreakData,
} from "@/lib/streak/persistence";
import { GRADE_LOG_APPENDED_EVENT } from "@/lib/gradelog/persistence";

describe("AutoSyncOnChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: FAKE_USER as unknown as ReturnType<typeof useAuth>["user"],
      supabase: FAKE_CLIENT,
    } as ReturnType<typeof useAuth>);
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
        new CustomEvent(SETTINGS_SAVED_EVENT, { detail: {} }),
      );
    });

    // Give the microtask queue a chance to drain
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
