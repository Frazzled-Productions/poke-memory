/**
 * StreakBadge tests - token earn/spend toast (#1438).
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
import { screen, act, fireEvent } from "@testing-library/react";
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
import { saveStreakData, STREAK_UPDATED_EVENT } from "@/lib/streak/persistence";
import { EARN_INTERVAL_DAYS, MAX_BALANCE, DEFAULT_STREAK_PROTECTION } from "@/lib/streak/tokens";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Stub out SuperuserContext so the component renders outside the provider.
const mockUseSuperuser = vi.fn(() => ({
  flags: { forceNextStreakMilestone: false, forceTokenToast: false },
  setFlag: vi.fn(),
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

// Stub PokemonLocaleContext - StreakBadge reads languagesEnabled to render the
// global/per-language divider. Exposed as a vi.fn() so individual tests can
// override the return value (e.g. to enable the multi-language branch).
// Default to languagesEnabled: false so existing tests are unaffected.
const mockUsePokemonLocaleContext = vi.fn(() => ({
  locale: "en" as const,
  languagesEnabled: false,
  learningLocales: ["en"],
}));
vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => mockUsePokemonLocaleContext(),
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
// State: 0 tokens, no earn activity - no toast
// ---------------------------------------------------------------------------

describe("StreakBadge - no toast states", () => {
  it("renders the streak badge without a toast when there is no earn/spend", () => {
    // Fresh settings - nothing to earn (today not a review day) and nothing to spend.
    seedProtection({ balance: 0 });

    renderWithIntl(<StreakBadge />);

    // The streak chip itself is present (start-streak prompt at streak 0).
    expect(screen.getByText(/start streak/i)).toBeInTheDocument();
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
// State: token earned - toast fires (AC happy-path requirement)
// ---------------------------------------------------------------------------

describe("StreakBadge - token earned", () => {
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

  it("does not re-fire the earn toast on a later streak event in the same visit", () => {
    // The earn fires once on mount; the `hasShownTokenToastRef` guard must stop
    // it re-appearing when a subsequent STREAK_UPDATED_EVENT triggers a refresh.
    seedProtection({
      balance: 0,
      daysSinceLastEarn: EARN_INTERVAL_DAYS - 1,
      streakDates: [FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    expect(screen.getByText(/streak protection token earned/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/dismiss token notice/i));
    expect(
      screen.queryByText(/streak protection token earned/i),
    ).toBeNull();

    // A later streak-updated event re-runs the protection refresh; the guard
    // keeps the toast dismissed rather than re-showing it.
    act(() => {
      window.dispatchEvent(new Event(STREAK_UPDATED_EVENT));
    });
    expect(
      screen.queryByText(/streak protection token earned/i),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State: token spent - toast fires
// ---------------------------------------------------------------------------

describe("StreakBadge - token spent", () => {
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
// State: earned-and-spent combo - single toast
// ---------------------------------------------------------------------------

describe("StreakBadge - earned-and-spent combo", () => {
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

    // Exactly one status element - not two.
    const statuses = screen.queryAllByRole("status");
    expect(statuses).toHaveLength(1);

    // Combined toast copy (not the plain earn copy).
    expect(
      screen.getByText(/streak protection token earned and used/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// State: at 3-token cap - earn is a no-op, no toast
// ---------------------------------------------------------------------------

describe("StreakBadge - at token cap", () => {
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
// Locale rendering - earn copy correct in all supported locales
// ---------------------------------------------------------------------------

describe("StreakBadge - locale: earn toast copy", () => {
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
      screen.getByText(/已获得连续保护令牌/),
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
// Locale rendering - spend copy correct in all supported locales
// ---------------------------------------------------------------------------

describe("StreakBadge - locale: spend toast copy", () => {
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

// ---------------------------------------------------------------------------
// Mobile status chips + milestone signpost. Since Phase 1 the StreakBadge row
// carries the shared streak/token/mastery chips (mobile-only; the bar carries
// them on md+). The old standalone "N protection tokens." pip is gone, replaced
// by the shared TokenChip. The milestone countdown is kept. IN and OUT covered.
// ---------------------------------------------------------------------------

describe("StreakBadge - mobile status chips + milestone signpost", () => {
  it("shows the status chips and the milestone signpost on a live streak", () => {
    // 3-day consecutive run ending today → milestone countdown visible.
    seedProtection({
      balance: 2,
      streakDates: ["2026-05-29", "2026-05-30", FIXED_TODAY],
    });

    renderWithIntl(<StreakBadge />);

    // The shared TokenChip is present (terse "2", full text in the aria-label).
    expect(screen.getByLabelText(/2 protection tokens/i)).toBeInTheDocument();
    // The old standalone "2 protection tokens." pip is gone.
    expect(screen.queryByText(/2 protection tokens\./i)).toBeNull();
    // Next-milestone signpost (nav.streakChip.milestoneLabel) remains.
    expect(
      screen.getByText(/to your next milestone\./i),
    ).toBeInTheDocument();
  });

  it("hides the signpost at streak zero (no milestone countdown without a streak)", () => {
    // No streak dates → streak 0.
    seedProtection({ balance: 0 });

    renderWithIntl(<StreakBadge />);

    expect(screen.queryByText(/to your next milestone/i)).toBeNull();
  });

  // Token pip must be absent in all locales (de-duped #1490).
  // Locale coverage for the milestone signpost copy (nav.streakChip.*).
  function seedSignpost() {
    seedProtection({
      balance: 2,
      streakDates: ["2026-05-29", "2026-05-30", FIXED_TODAY],
    });
  }

  it("ja: renders the milestone signpost in Japanese (no token pip)", () => {
    seedSignpost();
    renderJa(<StreakBadge />);
    // Token pip must be absent.
    expect(screen.queryByText(/保護トークン2個。/)).toBeNull();
    // Milestone signpost remains.
    expect(screen.getByText(/次の目標まであと/)).toBeInTheDocument();
  });

  it("zh-Hans: renders the milestone signpost in Simplified Chinese (no token pip)", () => {
    seedSignpost();
    renderZhHans(<StreakBadge />);
    // Token pip must be absent.
    expect(screen.queryByText(/2个保护令牌。/)).toBeNull();
    // Milestone signpost remains.
    expect(screen.getByText(/距下一个里程碑还有/)).toBeInTheDocument();
  });

  it("zh-Hant: renders the milestone signpost in Traditional Chinese (no token pip)", () => {
    seedSignpost();
    renderZhHant(<StreakBadge />);
    // Token pip must be absent.
    expect(screen.queryByText(/2個保護代幣。/)).toBeNull();
    // Milestone signpost remains.
    expect(screen.getByText(/距下一個里程碑還有/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// languagesEnabled: divider and per-language chip order (mirrors ProfileStatusBar)
// ---------------------------------------------------------------------------

describe("StreakBadge - languagesEnabled chip order and divider", () => {
  function seedLiveStreak() {
    // Seed a live 3-day streak so the token chip (balance=2) is rendered and
    // we can assert its position relative to the divider.
    seedProtection({
      balance: 2,
      streakDates: ["2026-05-29", "2026-05-30", FIXED_TODAY],
    });
  }

  it("single-language (off): does NOT render the hairline divider", () => {
    seedLiveStreak();
    // Default mock has languagesEnabled: false - no override needed.
    renderWithIntl(<StreakBadge />);

    const group = document.querySelector("[role='group']");
    expect(group).not.toBeNull();
    const divider = group!.querySelector('[aria-hidden="true"][class*="border-l"]');
    expect(divider).toBeNull();
  });

  it("multi-language (on): DOES render the hairline divider between global and per-language chips", () => {
    seedLiveStreak();
    // Use mockReturnValue (not Once) so every re-render triggered by the
    // useEffect state updates in StreakBadge consistently returns the enabled
    // state - mockReturnValueOnce is consumed on the first call.
    mockUsePokemonLocaleContext.mockReturnValue({
      locale: "en" as const,
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });

    renderWithIntl(<StreakBadge />);

    const group = document.querySelector("[role='group']");
    expect(group).not.toBeNull();
    const divider = group!.querySelector('[aria-hidden="true"][class*="border-l"]');
    expect(divider).not.toBeNull();

    // Restore default so subsequent tests are unaffected.
    mockUsePokemonLocaleContext.mockReturnValue({
      locale: "en" as const,
      languagesEnabled: false,
      learningLocales: ["en"],
    });
  });

  it("multi-language (on): TokenChip appears before the divider and MasteryChip after", () => {
    seedLiveStreak();
    mockUsePokemonLocaleContext.mockReturnValue({
      locale: "en" as const,
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });

    renderWithIntl(<StreakBadge />);

    const group = document.querySelector("[role='group']");
    expect(group).not.toBeNull();
    const divider = group!.querySelector('[aria-hidden="true"][class*="border-l"]');
    expect(divider).not.toBeNull();

    // The token chip (balance=2) must appear BEFORE the divider.
    const tokenChip = group!.querySelector('[aria-label*="protection token"]');
    expect(tokenChip).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING (4) means divider follows token in DOM order.
    const tokenBeforeDivider =
      (tokenChip!.compareDocumentPosition(divider!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(tokenBeforeDivider).toBe(true);

    // Restore default so subsequent tests are unaffected.
    mockUsePokemonLocaleContext.mockReturnValue({
      locale: "en" as const,
      languagesEnabled: false,
      learningLocales: ["en"],
    });
  });
});

// ---------------------------------------------------------------------------
// Superuser forceTokenToast flag (#1443 QA) - forces the earn helper toast so
// QA can verify the copy without grinding a 30-day streak. Self-clears on
// dismiss. IN (flag on, no real earn) and OUT (flag off) covered.
// ---------------------------------------------------------------------------

describe("StreakBadge - forceTokenToast superuser flag", () => {
  // Reset to a known-off default before each test so a per-test
  // mockReturnValue override cannot leak into the next test.
  beforeEach(() => {
    mockUseSuperuser.mockReturnValue({
      flags: { forceNextStreakMilestone: false, forceTokenToast: false },
      setFlag: vi.fn(),
    });
  });

  it("fires the earn toast on mount when the flag is on, with no real earn activity", () => {
    const setFlag = vi.fn();
    mockUseSuperuser.mockReturnValue({
      flags: { forceNextStreakMilestone: false, forceTokenToast: true },
      setFlag,
    });
    // Plain state: nothing to earn or spend on its own.
    seedProtection({ balance: 0 });

    renderWithIntl(<StreakBadge />);

    expect(
      screen.getByText(/streak protection token earned/i),
    ).toBeInTheDocument();
  });

  it("self-clears the flag when the forced toast is dismissed", () => {
    const setFlag = vi.fn();
    mockUseSuperuser.mockReturnValue({
      flags: { forceNextStreakMilestone: false, forceTokenToast: true },
      setFlag,
    });
    seedProtection({ balance: 0 });

    renderWithIntl(<StreakBadge />);

    fireEvent.click(screen.getByLabelText(/dismiss token notice/i));

    expect(setFlag).toHaveBeenCalledWith("forceTokenToast", false);
  });

  it("fires no forced toast when the flag is off", () => {
    // Default mock: forceTokenToast undefined/false. Plain state → no toast.
    seedProtection({ balance: 0 });

    renderWithIntl(<StreakBadge />);

    expect(
      screen.queryByText(/streak protection token earned/i),
    ).toBeNull();
  });
});
