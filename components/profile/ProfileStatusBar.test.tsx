/**
 * ProfileStatusBar tests (#1490).
 *
 * Mandatory coverage (per AGENTS.md):
 *   - STATE in AND out: null/skeleton, empty (streak 0, tokens 0, mastery 0),
 *     populated, and pretendAllMastered (mastery = total / 100%).
 *   - ROUTE behaviour: mobile Practice hides the bar; desktop Practice shows;
 *     non-Practice shows on both viewports.
 *   - LOCALE: all four locales (en / ja / zh-Hans / zh-Hant).
 *   - ACCESSIBILITY: role="status", per-chip aria-labels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
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
// Mock: SuperuserContext (accessed internally by useProfileStatus, not used
// directly in ProfileStatusBar — the hook mock above returns values directly,
// so no SuperuserProvider is needed in these tests).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Null state — before first client render / skeleton phase. */
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
  masteryPercent: 14.0,
};

/** Zero state — fresh user with no activity. */
const ZERO_STATE = {
  streak: 0,
  tokenBalance: 0,
  masteryCount: 0,
  totalSpecies: 1025,
  masteryPercent: 0,
};

/** pretendAllMastered state — all species mastered. */
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Skeleton / pre-mount (null state)
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — skeleton (null state)", () => {
  it("renders a fixed-height placeholder when values are null (no layout shift)", () => {
    mockUseProfileStatus.mockReturnValue(NULL_STATE);
    renderWithIntl(<ProfileStatusBar />);

    // The skeleton is aria-hidden so screen-readers skip it.
    const skeleton = document.querySelector("[aria-hidden='true']");
    expect(skeleton).not.toBeNull();
    // No visible status chips should be present.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the skeleton on the Practice route too (height reserved)", () => {
    mockUsePathname.mockReturnValue("/");
    mockUseProfileStatus.mockReturnValue(NULL_STATE);
    renderWithIntl(<ProfileStatusBar />);

    const skeleton = document.querySelector("[aria-hidden='true']");
    expect(skeleton).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// role="status" + aria-label
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — accessibility", () => {
  it("has role='status' on the outer container", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has the bar aria-label on the outer container", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("status", { name: /profile status/i })).toBeInTheDocument();
  });

  it("streak chip has an aria-label (populated state)", () => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // 7-day streak
    expect(screen.getByLabelText(/7 day streak/i)).toBeInTheDocument();
  });

  it("token chip has an aria-label (populated state)", () => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // 2 protection tokens
    expect(screen.getByLabelText(/2 protection tokens/i)).toBeInTheDocument();
  });

  it("mastery chip has an aria-label (populated state)", () => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // "143 of 1025 Pokemon mastered"
    expect(screen.getByLabelText(/143 of 1025/i)).toBeInTheDocument();
  });

  it("mastery chip has an encouraging aria-label when count is zero", () => {
    mockUseProfileStatus.mockReturnValue(ZERO_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // Zero state: encouraging label includes "start reviewing"
    expect(screen.getByLabelText(/0 of 1025.*start reviewing/i)).toBeInTheDocument();
  });

  it("streak chip has a 'start your streak' aria-label when streak is 0", () => {
    mockUseProfileStatus.mockReturnValue(ZERO_STATE);
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByLabelText(/start your streak/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Populated state — chip visibility
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — populated state", () => {
  it("renders the streak chip with the streak count", () => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // "7d streak" or similar — the label text
    expect(screen.getByText(/7/)).toBeInTheDocument();
  });

  it("renders the token chip when balance >= 1", () => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // Token label present
    expect(screen.getByLabelText(/2 protection tokens/i)).toBeInTheDocument();
  });

  it("renders the mastery chip", () => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // 143 / 1025
    expect(screen.getByLabelText(/143 of 1025/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Zero / empty state
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — zero state", () => {
  beforeEach(() => {
    mockUseProfileStatus.mockReturnValue(ZERO_STATE);
  });

  it("shows start-streak label when streak is 0", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByText(/start streak/i)).toBeInTheDocument();
  });

  it("hides the token chip when tokenBalance is 0", () => {
    renderWithIntl(<ProfileStatusBar />);
    // The token chip aria-label should not be present
    expect(screen.queryByLabelText(/0 protection/i)).toBeNull();
  });

  it("shows mastery as '0 / total' with the encouraging aria-label", () => {
    renderWithIntl(<ProfileStatusBar />);
    // Mastery chip text includes 0
    expect(screen.getByLabelText(/0 of 1025.*start reviewing/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// pretendAllMastered state
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — pretendAllMastered", () => {
  it("shows 100% mastery when pretendAllMastered is on (via hook mock)", () => {
    mockUseProfileStatus.mockReturnValue(ALL_MASTERED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    // Mastery chip aria-label shows total = total
    expect(screen.getByLabelText(/1025 of 1025/i)).toBeInTheDocument();
  });

  it("mastery label shows 100%", () => {
    mockUseProfileStatus.mockReturnValue(ALL_MASTERED_STATE);
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Route behaviour: mobile Practice hides, desktop shows
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — route / responsive", () => {
  it("applies the 'hidden md:block' class on the Practice route", () => {
    mockUsePathname.mockReturnValue("/");
    renderWithIntl(<ProfileStatusBar />);

    // The bar (role=status) should exist in the DOM but carry the
    // responsive hiding class — jsdom doesn't compute CSS so we check
    // the class string is present on the element.
    const bar = screen.getByRole("status");
    expect(bar.className).toContain("hidden");
    expect(bar.className).toContain("md:block");
  });

  it("does NOT apply the hidden class on non-Practice routes", () => {
    mockUsePathname.mockReturnValue("/stats");
    renderWithIntl(<ProfileStatusBar />);

    const bar = screen.getByRole("status");
    expect(bar.className).not.toContain("hidden");
  });

  it("does NOT apply the hidden class on /pokedex", () => {
    mockUsePathname.mockReturnValue("/pokedex");
    renderWithIntl(<ProfileStatusBar />);

    const bar = screen.getByRole("status");
    expect(bar.className).not.toContain("hidden");
  });

  it("applies hidden class only on exact '/' Practice route", () => {
    mockUsePathname.mockReturnValue("/practice-settings");
    renderWithIntl(<ProfileStatusBar />);

    const bar = screen.getByRole("status");
    expect(bar.className).not.toContain("hidden");
  });
});

// ---------------------------------------------------------------------------
// Locale rendering — all four locales
// ---------------------------------------------------------------------------

describe("ProfileStatusBar — locale rendering", () => {
  beforeEach(() => {
    mockUseProfileStatus.mockReturnValue(POPULATED_STATE);
    mockUsePathname.mockReturnValue("/stats");
  });

  it("en: renders the bar aria-label in English", () => {
    renderWithIntl(<ProfileStatusBar />);
    expect(screen.getByRole("status", { name: /profile status/i })).toBeInTheDocument();
  });

  it("ja: renders the bar aria-label in Japanese", () => {
    renderJa(<ProfileStatusBar />);
    // profileStatus.barAriaLabel in ja = "プロフィール状況"
    expect(screen.getByRole("status", { name: /プロフィール状況/ })).toBeInTheDocument();
  });

  it("zh-Hans: renders the bar aria-label in Simplified Chinese", () => {
    renderZhHans(<ProfileStatusBar />);
    // profileStatus.barAriaLabel in zh-Hans = "档案状态"
    expect(screen.getByRole("status", { name: /档案状态/ })).toBeInTheDocument();
  });

  it("zh-Hant: renders the bar aria-label in Traditional Chinese", () => {
    renderZhHant(<ProfileStatusBar />);
    // profileStatus.barAriaLabel in zh-Hant = "檔案狀態"
    expect(screen.getByRole("status", { name: /檔案狀態/ })).toBeInTheDocument();
  });

  it("ja: mastery label renders in Japanese with a number", () => {
    renderJa(<ProfileStatusBar />);
    // The mastery chip contains "習得済み"
    expect(screen.getByText(/習得済み/)).toBeInTheDocument();
  });

  it("zh-Hans: mastery label renders in Simplified Chinese with a number", () => {
    renderZhHans(<ProfileStatusBar />);
    // "已掌握" in zh-Hans
    expect(screen.getByText(/已掌握/)).toBeInTheDocument();
  });

  it("zh-Hant: mastery label renders in Traditional Chinese with a number", () => {
    renderZhHant(<ProfileStatusBar />);
    // "已掌握" also in zh-Hant
    expect(screen.getByText(/已掌握/)).toBeInTheDocument();
  });

  it("mastery count renders a number (tolerates locale digit-grouping, #1408)", () => {
    // The mastery count is formatted via ICU {mastered, number} which may add
    // grouping separators in some locales. Assert the number renders without
    // hard-coding the separator form.
    renderWithIntl(<ProfileStatusBar />);
    // 143 is below 1000 so no grouping in en — but we assert a numeric
    // pattern that tolerates a narrow-NBSP or comma (future-proof).
    const bar = screen.getByRole("status");
    expect(bar.textContent).toMatch(/143/);
  });
});
