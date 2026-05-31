/**
 * StreakBadge tests — token earn/spend toast (#1438).
 *
 * Covers:
 *  - 0 tokens (no toast)
 *  - Token earned (toast fires with correct copy)
 *  - Token spent (toast fires with correct copy)
 *  - Earned-and-spent combo (single toast, not two)
 *  - At 3-token cap (earn is a no-op, no re-fire)
 *  - Non-earn-day initial mount (no toast)
 *  - Toast dismissal
 *  - Locale rendering: en / ja / zh-Hans / zh-Hant
 *  - AC requirement: earn moment RENDERS (happy path asserted)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { StreakBadge } from "./StreakBadge";
import {
  saveSettings,
  loadSettings,
} from "@/lib/settings/persistence";
import { saveStreakData } from "@/lib/streak/persistence";
import { EARN_INTERVAL_DAYS, MAX_BALANCE, DEFAULT_STREAK_PROTECTION } from "@/lib/streak/tokens";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Stub out SuperuserContext so the component renders outside the provider.
const mockUseSuperuser = vi.fn(() => ({
  flags: { forceNextStreakMilestone: false },
  setFlag: vi.fn(),
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

// Pin todayString to a fixed date so tests are deterministic.
const FIXED_TODAY = "2026-05-31";
vi.mock("@/lib/review/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/session")>();
  return { ...actual, todayString: () => FIXED_TODAY };
});

// ---------------------------------------------------------------------------
// localStorage stub (same pattern as runProtection.test.tsx)
// ---------------------------------------------------------------------------

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
  vi.useFakeTimers();
  Object.defineProperty(window, "localStorage", {
    value: makeLocalStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { localStorage?: unknown }).localStorage;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed settings with a specific protection state and optionally streak data.
 */
function seedProtection(opts: {
  balance?: number;
  daysSinceLastEarn?: number;
  lastEarnCheckDate?: string | null;
  spendDates?: string[];
  streakDates?: string[];
}) {
  saveSettings({
    ...loadSettings(),
    streakProtection: {
      ...DEFAULT_STREAK_PROTECTION,
      balance: opts.balance ?? 0,
      daysSinceLastEarn: opts.daysSinceLastEarn ?? 0,
      lastEarnCheckDate: opts.lastEarnCheckDate ?? null,
      spendDates: opts.spendDates ?? [],
    },
  });
  if (opts.streakDates) {
    saveStreakData(opts.streakDates);
  }
}

// ---------------------------------------------------------------------------
// State: 0 tokens, no earn activity — no toast
// ---------------------------------------------------------------------------

describe("StreakBadge — no toast states", () => {
  it("renders the streak badge without a toast when there is no earn/spend", () => {
    // Fresh settings — nothing to earn (today not a review day) and nothing to spend.
    seedProtection({ balance: 0 });

    renderWithIntl(<StreakBadge />);

    // The streak badge itself is present.
    expect(screen.getByText("Start your streak!")).toBeInTheDocument();
    // No protection toast.
    expect(screen.queryByRole("status", { name: /dismiss token/i })).toBeNull();
  });

  it("renders no toast on a review day where counter has not hit threshold", () => {
    seedProtection({
      balance: 0,
      daysSinceLastEarn: 5,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    expect(screen.queryByLabelText(/dismiss token/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State: token earned — toast fires (AC happy-path requirement)
// ---------------------------------------------------------------------------

describe("StreakBadge — token earned", () => {
  it("shows the earn toast when a token is earned on mount (HAPPY PATH)", () => {
    // Set up so today's review day pushes the counter to the threshold.
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    // The earn toast must be visible.
    expect(
      screen.getByText(/streak protection token earned/i),
    ).toBeInTheDocument();
    // The role=status element is present.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("earn toast has role=status for accessible announcement", () => {
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("earn toast is dismissible by user click", () => {
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    const dismissButton = screen.getByLabelText(/dismiss token notice/i);
    fireEvent.click(dismissButton);

    expect(
      screen.queryByText(/streak protection token earned/i),
    ).toBeNull();
  });

  it("earn toast auto-dismisses after timeout", () => {
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    expect(screen.getByText(/streak protection token earned/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(
      screen.queryByText(/streak protection token earned/i),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State: token spent — toast fires
// ---------------------------------------------------------------------------

describe("StreakBadge — token spent", () => {
  it("shows the spend toast when a token is spent to bridge a missed day", () => {
    // Balance = 1, reviewed two days ago, missed yesterday.
    const dayBeforeYesterday = "2026-05-29";
    seedProtection({
      balance: 1,
      streakDates: [dayBeforeYesterday],
    });

    renderWithIntl(<StreakBadge />);

    expect(
      screen.getByText(/we used a protection token/i),
    ).toBeInTheDocument();
  });

  it("spend toast is dismissible", () => {
    const dayBeforeYesterday = "2026-05-29";
    seedProtection({
      balance: 1,
      streakDates: [dayBeforeYesterday],
    });

    renderWithIntl(<StreakBadge />);

    fireEvent.click(screen.getByLabelText(/dismiss token notice/i));
    expect(screen.queryByText(/we used a protection token/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State: earned-and-spent combo — single toast
// ---------------------------------------------------------------------------

describe("StreakBadge — earned-and-spent combo", () => {
  it("shows a single combined toast, not two separate toasts", () => {
    // Balance=0 means Phase 1 cannot spend. After Phase 2 earns (counter hits
    // threshold), Phase 3 spends the freshly earned token to bridge yesterday.
    const dayBeforeYesterday = "2026-05-29";
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      // Yesterday was missed. Today is a review day.
      streakDates: [dayBeforeYesterday, FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    // Exactly one status element — not two.
    const statuses = screen.queryAllByRole("status");
    expect(statuses).toHaveLength(1);

    // Combined toast copy (not the plain earn copy).
    expect(
      screen.getByText(/streak protection token earned and used/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// State: at 3-token cap — earn is a no-op, no toast
// ---------------------------------------------------------------------------

describe("StreakBadge — at token cap", () => {
  it("shows no earn toast when the balance is already at the cap", () => {
    // Balance = MAX_BALANCE (3). Earning while capped does NOT increment the
    // balance, so `earned=false` from applyProtectionStep.
    seedProtection({
      balance: MAX_BALANCE,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    expect(screen.queryByLabelText(/dismiss token notice/i)).toBeNull();
    expect(
      screen.queryByText(/streak protection token earned/i),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Locale rendering — earn copy correct in all supported locales
// ---------------------------------------------------------------------------

describe("StreakBadge — locale: earn toast copy", () => {
  function seedEarn() {
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });
  }

  it("en: renders earn toast in English", () => {
    seedEarn();
    renderWithIntl(<StreakBadge />);
    expect(
      screen.getByText(/streak protection token earned/i),
    ).toBeInTheDocument();
  });

  it("ja: renders earn toast in Japanese", () => {
    seedEarn();
    renderJa(<StreakBadge />);
    // Japanese earn message contains the token description in Japanese.
    expect(
      screen.getByText(/連続ストリーク保護トークンを獲得/),
    ).toBeInTheDocument();
  });

  it("zh-Hans: renders earn toast in Simplified Chinese", () => {
    seedEarn();
    renderZhHans(<StreakBadge />);
    expect(
      screen.getByText(/已獲得連続保護令牌|已获得连续保护令牌/),
    ).toBeInTheDocument();
  });

  it("zh-Hant: renders earn toast in Traditional Chinese", () => {
    seedEarn();
    renderZhHant(<StreakBadge />);
    expect(
      screen.getByText(/已獲得連續保護令牌/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale rendering — spend copy correct in all supported locales
// ---------------------------------------------------------------------------

describe("StreakBadge — locale: spend toast copy", () => {
  function seedSpend() {
    const dayBeforeYesterday = "2026-05-29";
    seedProtection({
      balance: 1,
      streakDates: [dayBeforeYesterday],
    });
  }

  it("en: renders spend toast in English", () => {
    seedSpend();
    renderWithIntl(<StreakBadge />);
    expect(screen.getByText(/we used a protection token/i)).toBeInTheDocument();
  });

  it("ja: renders spend toast in Japanese", () => {
    seedSpend();
    renderJa(<StreakBadge />);
    expect(screen.getByText(/保護トークンを使用/)).toBeInTheDocument();
  });

  it("zh-Hans: renders spend toast in Simplified Chinese", () => {
    seedSpend();
    renderZhHans(<StreakBadge />);
    expect(screen.getByText(/已使用保護令牌|已使用保护令牌/)).toBeInTheDocument();
  });

  it("zh-Hant: renders spend toast in Traditional Chinese", () => {
    seedSpend();
    renderZhHant(<StreakBadge />);
    expect(screen.getByText(/已使用保護令牌/)).toBeInTheDocument();
  });
});
