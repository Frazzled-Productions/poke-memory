import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
import { StreakProtectionCard } from "./StreakProtectionCard";
import {
  saveSettings,
  loadSettings,
  STORAGE_KEY,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";
import { DEFAULT_STREAK_PROTECTION } from "@/lib/streak";
import { saveStreakData } from "@/lib/streak/persistence";
import { todayString } from "@/lib/review/session";

// jsdom on this Node version does not ship localStorage; provide a stub.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, String(v));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete (window as unknown as { localStorage?: unknown }).localStorage;
});

describe("StreakProtectionCard", () => {
  it("renders zero balance with the correct copy", () => {
    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // The heading is always present so we know the section rendered.
    expect(
      screen.getByRole("heading", { name: "Streak protection" }),
    ).toBeInTheDocument();
    // 0 + "protection tokens" - verify via the explicit aria-label.
    expect(screen.getByLabelText("0 protection tokens")).toBeInTheDocument();
  });

  it("renders a non-zero balance and the recent-spend history line", () => {
    // Pre-seed settings with a non-trivial protection state so the card has
    // something to show. The card listens to SETTINGS_SAVED_EVENT, but on
    // mount it reads loadSettings() once so a fresh seed is enough.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 2,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 5,
          lastEarnCheckDate: "2026-05-09",
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(screen.getByLabelText("2 protection tokens")).toBeInTheDocument();
    // History line.
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent(/Streak preserved on/);
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent(/2 protection tokens/);
  });

  it("singularises the history-line balance when one token remains", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 1,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-09",
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent(/1 protection token/);
  });

  it("does not render the history line when no spend has happened", () => {
    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-last-spend"),
    ).not.toBeInTheDocument();
  });

  it("refreshes when settings are saved", () => {
    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(screen.getByLabelText("0 protection tokens")).toBeInTheDocument();

    act(() => {
      saveSettings({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 3,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
        },
      });
    });

    expect(screen.getByLabelText("3 protection tokens")).toBeInTheDocument();
    // "(max)" label appears at the cap.
    expect(screen.getByText(/\(max\)/)).toBeInTheDocument();
  });

  it("dispatches SETTINGS_SAVED_EVENT after saveSettings - guard for the refresh test", () => {
    const handler = vi.fn();
    window.addEventListener(SETTINGS_SAVED_EVENT, handler);
    saveSettings(loadSettings());
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(SETTINGS_SAVED_EVENT, handler);
  });

  it("renders recent protection events when present", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 1,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 5,
          lastEarnCheckDate: "2026-05-09",
          protectionEvents: [
            { date: "2026-04-01", kind: "earned" },
            { date: "2026-05-02", kind: "spent" },
            { date: "2026-05-09", kind: "earned-and-spent" },
          ],
          lastAcknowledgedProtectionEventDate: "2026-05-09",
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    const eventsSection = screen.getByTestId("streak-protection-recent-events");
    expect(eventsSection).toBeInTheDocument();
    expect(eventsSection).toHaveTextContent("Recent protection");
    // Most recent first - earned-and-spent then spent then earned.
    expect(eventsSection).toHaveTextContent("Earned + used");
    expect(eventsSection).toHaveTextContent("Used");
    expect(eventsSection).toHaveTextContent("Earned");
  });

  it("does not render recent events when the list is empty", () => {
    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-recent-events"),
    ).not.toBeInTheDocument();
  });

  it("shows the earn-and-spend banner when the latest event is unacknowledged", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 0,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-09",
          protectionEvents: [{ date: "2026-05-09", kind: "earned-and-spent" }],
          lastAcknowledgedProtectionEventDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.getByTestId("streak-protection-earn-spend-banner"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("streak-protection-earn-spend-banner"),
    ).toHaveTextContent("Your streak is safe");
  });

  it("does not show the banner when the latest earn-and-spent event is acknowledged", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 0,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-09",
          protectionEvents: [{ date: "2026-05-09", kind: "earned-and-spent" }],
          lastAcknowledgedProtectionEventDate: "2026-05-09",
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-earn-spend-banner"),
    ).not.toBeInTheDocument();
  });

  it("dismissing the banner saves the acknowledged date and hides the banner", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 0,
          spendDates: ["2026-05-08"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-09",
          protectionEvents: [{ date: "2026-05-09", kind: "earned-and-spent" }],
          lastAcknowledgedProtectionEventDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    const banner = screen.getByTestId("streak-protection-earn-spend-banner");
    expect(banner).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Dismiss streak protection notice/ }));
    });

    expect(
      screen.queryByTestId("streak-protection-earn-spend-banner"),
    ).not.toBeInTheDocument();
  });

  it("does not show the banner when there are no earned-and-spent events", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 1,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-09",
          protectionEvents: [{ date: "2026-05-09", kind: "earned" }],
          lastAcknowledgedProtectionEventDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-earn-spend-banner"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Multi-day bridge rendering (#1399)
// ---------------------------------------------------------------------------

describe("StreakProtectionCard - multi-day bridge (#1399)", () => {
  it("renders correctly after a 3-day bridge: balance, last-spend date, and spend event", () => {
    // Simulate the state after applyProtectionStep bridged a 3-day absence.
    // User had balance=3, missed days 05-02, 05-03, 05-04, opened on 05-05.
    // Result: balance=0, spendDates=[05-02, 05-03, 05-04], one "spent" event.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 0,
          spendDates: ["2026-05-02", "2026-05-03", "2026-05-04"],
          daysSinceLastEarn: 10,
          lastEarnCheckDate: "2026-05-01",
          protectionEvents: [{ date: "2026-05-05", kind: "spent" }],
          lastAcknowledgedProtectionEventDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // Balance shows 0.
    expect(screen.getByLabelText("0 protection tokens")).toBeInTheDocument();
    // History line shows the most recent spend date (last entry in spendDates).
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent("Streak preserved on");
    expect(
      screen.getByTestId("streak-protection-last-spend"),
    ).toHaveTextContent("2026-05-04");
    // Recent events list contains the combined spend event.
    const eventsSection = screen.getByTestId("streak-protection-recent-events");
    expect(eventsSection).toBeInTheDocument();
    expect(eventsSection).toHaveTextContent("Used");
    expect(eventsSection).toHaveTextContent("2026-05-05");
  });

  it("renders correctly after a combined earn-and-spend: balance=1 with earned-and-spent event", () => {
    // User had balance=3 (bridged 3 days) and earned a token in the same step.
    // Net: balance=1, one "earned-and-spent" event.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          balance: 1,
          spendDates: ["2026-05-02", "2026-05-03", "2026-05-04"],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: "2026-05-05",
          protectionEvents: [{ date: "2026-05-05", kind: "earned-and-spent" }],
          lastAcknowledgedProtectionEventDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(screen.getByLabelText("1 protection token")).toBeInTheDocument();
    // The earn-and-spend banner should appear (unacknowledged).
    expect(
      screen.getByTestId("streak-protection-earn-spend-banner"),
    ).toBeInTheDocument();
    // Recent events list shows "Earned + used".
    const eventsSection = screen.getByTestId("streak-protection-recent-events");
    expect(eventsSection).toHaveTextContent("Earned + used");
  });
});

// ---------------------------------------------------------------------------
// Locale coverage (mandatory per AGENTS.md - #1393)
// ---------------------------------------------------------------------------

describe("StreakProtectionCard - Japanese locale (#1393)", () => {
  it("renders the Japanese heading in ja locale", () => {
    renderJa(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // ja stats.streakProtection.heading = "連続記録の保護"
    expect(
      screen.getByRole("heading", { name: "連続記録の保護" }),
    ).toBeInTheDocument();
  });

  it("renders the Japanese token aria-label for zero balance in ja locale", () => {
    renderJa(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // ja stats.streakProtection.tokensRemaining (0 tokens) = "0 トークン残り"
    // The aria-label is produced by the ICU plural - verify the section rendered correctly.
    expect(
      screen.getByRole("heading", { name: "連続記録の保護" }),
    ).toBeInTheDocument();
    // The token count region is present - check via the labelledby pattern.
    // The token label "0 トークン残り" is the aria-label on the count element.
    expect(screen.getByLabelText("0 トークン残り")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// tokenCount ICU plural - count=1 and count>1 (Fix 2, #1408 review)
// ---------------------------------------------------------------------------

describe("StreakProtectionCard - tokenCount ICU plural (#1408)", () => {
  it("en: count=1 renders the singular 'token' label", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 1,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // The muted label next to the large balance number uses tokenCount.
    // count=1 → "token" (ICU 'one' branch).
    const labelEl = screen.getByLabelText("1 protection token");
    expect(labelEl).toBeInTheDocument();
    // The muted sibling renders the ICU label text, not raw tokenSingular.
    // We verify the muted span renders "token" (no "s").
    expect(labelEl.nextElementSibling?.textContent).toMatch(/^token(\s|\()?/);
  });

  it("en: count=2 renders the plural 'tokens' label", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 2,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    const labelEl = screen.getByLabelText("2 protection tokens");
    expect(labelEl).toBeInTheDocument();
    // count=2 → "tokens" (ICU 'other' branch).
    expect(labelEl.nextElementSibling?.textContent).toMatch(/^tokens(\s|\()?/);
  });

  it("ja: count=1 renders the Japanese token label (no English 's' suffix)", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 1,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
        },
      }),
    );

    renderJa(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    // ja tokensRemaining: "1 トークン残り"
    const labelEl = screen.getByLabelText("1 トークン残り");
    expect(labelEl).toBeInTheDocument();
    // tokenCount in ja 'other' branch = "トークン" (no English plural suffix)
    expect(labelEl.nextElementSibling?.textContent).toContain("トークン");
    expect(labelEl.nextElementSibling?.textContent).not.toContain("token");
  });

  it("zh-Hans: count=2 renders the Chinese token label", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...loadSettings(),
        streakProtection: {
          ...DEFAULT_STREAK_PROTECTION,
          balance: 2,
          spendDates: [],
          daysSinceLastEarn: 0,
          lastEarnCheckDate: null,
        },
      }),
    );

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />, {
      locale: "zh-Hans",
    });
    // zh-Hans tokensRemaining: "剩余 2 个令牌"
    const labelEl = screen.getByLabelText("剩余 2 个令牌");
    expect(labelEl).toBeInTheDocument();
    // tokenCount in zh-Hans 'other' branch = "个令牌"
    expect(labelEl.nextElementSibling?.textContent).toContain("令牌");
  });

  // -------------------------------------------------------------------------
  // Streak line removed (#1490 de-dup): ProfileStatusBar carries the streak
  // on all routes. Verify the streak-protection-streak testid is gone.
  // -------------------------------------------------------------------------

  it("does NOT render the streak line (removed in #1490 de-dup)", () => {
    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-streak"),
    ).not.toBeInTheDocument();
  });

  it("does NOT render streak text even when streak data is present", () => {
    const today = todayString(new Date(), loadSettings().timezone ?? "UTC");
    saveStreakData([today]);

    renderWithIntl(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-streak"),
    ).not.toBeInTheDocument();
    // Streak copy must not appear in the card body.
    expect(screen.queryByText(/1-day streak/i)).not.toBeInTheDocument();
  });

  it("ja: does NOT render the streak line in Japanese locale", () => {
    const today = todayString(new Date(), loadSettings().timezone ?? "UTC");
    saveStreakData([today]);

    renderJa(<StreakProtectionCard dateFormat="iso" timezone="UTC" />);
    expect(
      screen.queryByTestId("streak-protection-streak"),
    ).not.toBeInTheDocument();
    // Japanese streak copy must not appear.
    expect(screen.queryByText(/1日連続。/)).not.toBeInTheDocument();
  });
});
