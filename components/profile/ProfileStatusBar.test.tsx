/**
 * ProfileStatusBar tests (#1490).
 *
 * Mandatory coverage (per AGENTS.md):
 *   - STATE in AND out: null/skeleton, zero (streak 0, tokens 0, mastery 0),
 *     populated, and pretendAllMastered (mastery = total / 100%).
 *   - ROUTE behaviour: mobile Practice hides the bar (`hidden md:block`);
 *     non-Practice shows on both viewports.
 *   - LOCALE: all four locales (en / ja / zh-Hans / zh-Hant).
 *   - ACCESSIBILITY: role="region" named landmark, per-chip aria-labels.
 *
 * Chips render terse labels (streak "7d", token "2", mastery "14%"); the full
 * descriptive text lives in each chip's aria-label.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { ProfileStatusBar } from "./ProfileStatusBar";

// ---------------------------------------------------------------------------
// Mock: useProfileStatus (lib/profile/useProfileStatus.ts)
// ---------------------------------------------------------------------------

const mockUseProfileStatus = vi.fn();
vi.mock("@/lib/profile/useProfileStatus", () => ({
  useProfileStatus: () => mockUseProfileStatus(),
}));

// ---------------------------------------------------------------------------
// Mock: usePathname (next/navigation)
// ---------------------------------------------------------------------------

const mockUsePathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

// ---------------------------------------------------------------------------
// Mock: usePokemonLocaleContext (lib/i18n/PokemonLocaleContext)
// ---------------------------------------------------------------------------

const mockUsePokemonLocaleContext = vi.fn(() => ({
  locale: "en" as const,
  languagesEnabled: false,
  learningLocales: ["en"],
}));
vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => mockUsePokemonLocaleContext(),
}));

// Stub LanguageSwitcher - its own test covers it; here we just need it to
// render something stable so we can test the bar structure around it.
vi.mock("@/components/i18n/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <span data-testid="language-switcher" />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Null state - before first client render / skeleton phase. */
const NULL_STATE = {
  streak: null,
  tokenBalance: null,
  masteryCount: null,
  totalSpecies: null,
  masteryPercent: null,
};

/** Populated state with a live streak, tokens, and some mastery. */
const POPULATED_STATE = {
  streak: 7,
  tokenBalance: 2,
  masteryCount: 143,
  totalSpecies: 1025,
  masteryPercent: 14,
};

/** Zero state - fresh user with no activity. */
const ZERO_STATE = {
  streak: 0,
  tokenBalance: 0,
  masteryCount: 0,
  totalSpecies: 1025,
  masteryPercent: 0,
};

/** pretendAllMastered state - all species mastered. */
const ALL_MASTERED_STATE = {
  streak: 5,
  tokenBalance: 1,
  masteryCount: 1025,
  totalSpecies: 1025,
  masteryPercent: 100,
};

beforeEach(() => {
  mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
  mockUsePathname.mockReturnValue("/stats");
  mockUsePokemonLocaleContext.mockReturnValue({
    locale: "en" as const,
    languagesEnabled: false,
    learningLocales: ["en"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Skeleton / pre-mount (null state)
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - skeleton (null state)", () => {
  it("renders a fixed-height placeholder when values are null (no layout shift)", () => {
    mockUseProfileStatus.mockReturnValue(NULL_STATE);
    renderWithIntl(<ProfileStatusBar />);

    // The skeleton is aria-hidden so screen-readers skip it, and the bar
    // landmark is not yet present.
    expect(document.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders the skeleton on the Practice route too (height reserved)", () => {
    mockUsePathname.mockReturnValue("/");
    mockUseProfileStatus.mockReturnValue(NULL_STATE);
    renderWithIntl(<ProfileStatusBar />);

    expect(document.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Accessibility - role="region" + per-chip aria-labels (chips are buttons now)
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - accessibility", () => {
  it("is a named region landmark (not a live status region)", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(
      screen.getByRole("region", { name: /profile status/i }),
    ).toBeInTheDocument();
    // It must NOT be a live region - would announce on every navigation.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("streak chip is a button with an aria-label (populated state)", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /7 days streak/i })).toBeInTheDocument();
  });

  it("token chip is a button with an aria-label (populated state)", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /2 protection tokens/i })).toBeInTheDocument();
  });

  it("mastery chip is a button with an aria-label (populated state)", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /143 of 1025/i })).toBeInTheDocument();
  });

  it("mastery chip has an encouraging aria-label when count is zero", () => {
    mockUseProfileStatus.mockReturnValue(ZERO_STATE);
    renderWithIntl(<ProfileStatusBar />);
    expect(
      screen.getByRole("button", { name: /0 of 1025.*start reviewing/i }),
    ).toBeInTheDocument();
  });

  it("streak chip has a 'start your streak' aria-label when streak is 0", () => {
    mockUseProfileStatus.mockReturnValue(ZERO_STATE);
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /start your streak/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Populated state - chip visibility + terse labels
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - populated state", () => {
  it("renders the streak chip with the terse day count", () => {
    renderWithIntl(<ProfileStatusBar />);
    // streakLabel "{count}d" → "7d"
    expect(screen.getByText("7d")).toBeInTheDocument();
  });

  it("renders the token chip with the terse count when balance >= 1", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /2 protection tokens/i })).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the mastery chip as a percentage", () => {
    renderWithIntl(<ProfileStatusBar />);
    // Terse label is the percentage; the count lives in the aria-label.
    const mastery = screen.getByRole("button", { name: /143 of 1025/i });
    expect(mastery.textContent).toMatch(/14.*%/);
  });
});

// ---------------------------------------------------------------------------
// Zero / empty state
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - zero state", () => {
  beforeEach(() => {
    mockUseProfileStatus.mockReturnValue(ZERO_STATE);
  });

  it("shows the start-streak label when streak is 0", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByText(/start streak/i)).toBeInTheDocument();
  });

  it("hides the token chip when tokenBalance is 0", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.queryByRole("button", { name: /protection token/i })).toBeNull();
  });

  it("still shows the mastery chip at zero (teaches the goal)", () => {
    renderWithIntl(<ProfileStatusBar />);
    const mastery = screen.getByRole("button", { name: /0 of 1025.*start reviewing/i });
    expect(mastery.textContent).toMatch(/0.*%/);
  });
});

// ---------------------------------------------------------------------------
// pretendAllMastered state
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - pretendAllMastered", () => {
  beforeEach(() => {
    mockUseProfileStatus.mockReturnValue(ALL_MASTERED_STATE);
  });

  it("shows total/total in the mastery aria-label", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /1025 of 1025/i })).toBeInTheDocument();
  });

  it("mastery label shows 100%", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByText(/100.*%/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Route behaviour: mobile Practice hides, non-Practice shows
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - route / responsive", () => {
  it("applies the 'hidden md:block' class on the Practice route", () => {
    mockUsePathname.mockReturnValue("/");
    renderWithIntl(<ProfileStatusBar />);

    const bar = screen.getByRole("region", { name: /profile status/i });
    expect(bar.className).toContain("hidden");
    expect(bar.className).toContain("md:block");
  });

  it("does NOT apply the hidden class on non-Practice routes", () => {
    mockUsePathname.mockReturnValue("/stats");
    renderWithIntl(<ProfileStatusBar />);
    const bar = screen.getByRole("region", { name: /profile status/i });
    expect(bar.className).not.toContain("hidden");
  });

  it("does NOT apply the hidden class on /pokedex", () => {
    mockUsePathname.mockReturnValue("/pokedex");
    renderWithIntl(<ProfileStatusBar />);
    const bar = screen.getByRole("region", { name: /profile status/i });
    expect(bar.className).not.toContain("hidden");
  });

  it("applies the hidden class only on the exact '/' Practice route", () => {
    mockUsePathname.mockReturnValue("/practice-settings");
    renderWithIntl(<ProfileStatusBar />);
    const bar = screen.getByRole("region", { name: /profile status/i });
    expect(bar.className).not.toContain("hidden");
  });
});

// ---------------------------------------------------------------------------
// Locale rendering - all four locales
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - locale rendering", () => {
  beforeEach(() => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    mockUsePathname.mockReturnValue("/stats");
  });

  it("en: renders the region aria-label in English", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(
      screen.getByRole("region", { name: /profile status/i }),
    ).toBeInTheDocument();
  });

  it("ja: renders the region aria-label in Japanese", () => {
    renderJa(<ProfileStatusBar />);
    expect(
      screen.getByRole("region", { name: /プロフィール状況/ }),
    ).toBeInTheDocument();
  });

  it("zh-Hans: renders the region aria-label in Simplified Chinese", () => {
    renderZhHans(<ProfileStatusBar />);
    expect(
      screen.getByRole("region", { name: /档案状态/ }),
    ).toBeInTheDocument();
  });

  it("zh-Hant: renders the region aria-label in Traditional Chinese", () => {
    renderZhHant(<ProfileStatusBar />);
    expect(
      screen.getByRole("region", { name: /檔案狀態/ }),
    ).toBeInTheDocument();
  });

  it("ja: mastery aria-label renders in Japanese", () => {
    renderJa(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /習得済み/ })).toBeInTheDocument();
  });

  it("zh-Hans: mastery aria-label renders in Simplified Chinese", () => {
    renderZhHans(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /已掌握/ })).toBeInTheDocument();
  });

  it("zh-Hant: mastery aria-label renders in Traditional Chinese", () => {
    renderZhHant(<ProfileStatusBar />);
    expect(screen.getByRole("button", { name: /已掌握/ })).toBeInTheDocument();
  });

  it("renders a numeric percentage (tolerates locale digit-grouping, #1408)", () => {
    renderWithIntl(<ProfileStatusBar />);
    const bar = screen.getByRole("region", { name: /profile status/i });
    expect(bar.textContent).toMatch(/\d/);
  });
});

// ---------------------------------------------------------------------------
// Bar height: must not change (h-9 class) - chips are interactive but the
// bar height is fixed so mobile Practice one-viewport fit is preserved (#1556)
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - bar height unchanged (#1556)", () => {
  it("the inner flex row keeps the h-9 class after making chips interactive", () => {
    renderWithIntl(<ProfileStatusBar />);
    const bar = screen.getByRole("region", { name: /profile status/i });
    // The h-9 height class must appear somewhere in the bar subtree (the inner
    // flex row, not the outer region wrapper which has no h-9).
    expect(bar.innerHTML).toContain("h-9");
  });
});

// ---------------------------------------------------------------------------
// Popover integration in the bar - chip click opens popover over bar content
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - popover opens in bar context (#1556)", () => {
  it("clicking the streak chip shows a popover with the streak description", () => {
    renderWithIntl(<ProfileStatusBar />);

    // No popover before click.
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /7 days streak/i }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.textContent).toMatch(/7 days streak/i);
  });

  it("clicking the mastery chip shows a popover with the mastery description", () => {
    renderWithIntl(<ProfileStatusBar />);

    fireEvent.click(screen.getByRole("button", { name: /143 of 1025/i }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/143 of 1025/i);
  });
});

// ---------------------------------------------------------------------------
// Item 2: Status-bar divider - present when languages flag on, absent when off
// ---------------------------------------------------------------------------

describe("ProfileStatusBar - clarity polish: global/per-language divider (item 2)", () => {
  beforeEach(() => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    mockUsePathname.mockReturnValue("/stats");
  });

  it("renders the divider when the languages Labs flag is on", () => {
    mockUsePokemonLocaleContext.mockReturnValue({
      locale: "en" as const,
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });
    renderWithIntl(<ProfileStatusBar />);

    const bar = screen.getByRole("region", { name: /profile status/i });
    // The divider is a <span aria-hidden="true"> with a border-l class.
    const divider = bar.querySelector('[aria-hidden="true"][class*="border-l"]');
    expect(divider).not.toBeNull();
  });

  it("does NOT render the divider when the languages Labs flag is off", () => {
    mockUsePokemonLocaleContext.mockReturnValue({
      locale: "en" as const,
      languagesEnabled: false,
      learningLocales: ["en"],
    });
    renderWithIntl(<ProfileStatusBar />);

    const bar = screen.getByRole("region", { name: /profile status/i });
    const divider = bar.querySelector('[aria-hidden="true"][class*="border-l"]');
    expect(divider).toBeNull();
  });
});
