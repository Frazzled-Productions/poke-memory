/**
 * Locale-rendering tests for MilestoneShareButton (#1933).
 *
 * The milestone banner and share text used to be raw English literals built
 * in lib/journey/milestones.ts, bypassing the message catalogue. They now
 * render through `journey.milestoneShare.*` via next-intl, so every supported
 * app locale must show a translated, achievement-framed banner - and the
 * share text (clipboard fallback path) must be localised too.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import {
  renderWithIntl,
  screen,
  type TestLocale,
} from "@/components/test-utils/renderWithIntl";
import { MilestoneShareButton } from "./MilestoneShareButton";
import type { Milestone } from "@/lib/journey/milestones";

// Mock the image generator - canvas is not available in jsdom.
vi.mock("@/lib/share/generateShareImage", () => ({
  generateMilestoneShareImage: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const countMilestone: Milestone = {
  id: "mastery-100",
  kind: "mastery-count",
  threshold: 100,
};

const genMilestone: Milestone = {
  id: "gen-1-complete",
  kind: "gen-complete",
  gen: 1,
};

const allMasteredMilestone: Milestone = {
  id: "all-mastered",
  kind: "all-mastered",
};

// Expected banner copy per locale. The mastery-count case is the #1933
// headline: it must read as a crossed milestone, never a bare live count.
const EXPECTED: Record<
  Exclude<TestLocale, "xx-pseudo">,
  { count: string; gen: string; all: string; shareCount: string }
> = {
  en: {
    count: "Milestone reached: 100 Pokémon mastered!",
    gen: "Generation I complete!",
    all: "You've mastered all Pokémon!",
    shareCount:
      "I've passed the 100 Pokémon mastered milestone in Poké Memory! 🌟 https://pokememory.com",
  },
  ja: {
    count: "マイルストーン達成：100匹のポケモンを習得！",
    gen: "第1世代コンプリート！",
    all: "すべてのポケモンを習得しました！",
    shareCount:
      "Poké Memoryで100匹習得のマイルストーンを達成しました！🌟 https://pokememory.com",
  },
  "zh-Hans": {
    count: "达成里程碑：已掌握 100 只宝可梦！",
    gen: "第 1 世代全部掌握！",
    all: "你已掌握所有宝可梦！",
    shareCount:
      "我在 Poké Memory 达成了掌握 100 只宝可梦的里程碑！🌟 https://pokememory.com",
  },
  "zh-Hant": {
    count: "達成里程碑：已掌握 100 隻寶可夢！",
    gen: "第 1 世代全部掌握！",
    all: "你已掌握所有寶可夢！",
    shareCount:
      "我在 Poké Memory 達成了掌握 100 隻寶可夢的里程碑！🌟 https://pokememory.com",
  },
};

const LOCALES = Object.keys(EXPECTED) as Array<
  Exclude<TestLocale, "xx-pseudo">
>;

// ---------------------------------------------------------------------------
// Banner labels
// ---------------------------------------------------------------------------

describe.each(LOCALES)("MilestoneShareButton banner - %s locale", (locale) => {
  it("renders the achievement-framed mastery-count banner", () => {
    renderWithIntl(<MilestoneShareButton milestone={countMilestone} />, {
      locale,
    });
    expect(screen.getByText(EXPECTED[locale].count)).toBeInTheDocument();
  });

  it("renders the gen-complete banner", () => {
    renderWithIntl(<MilestoneShareButton milestone={genMilestone} />, {
      locale,
    });
    expect(screen.getByText(EXPECTED[locale].gen)).toBeInTheDocument();
  });

  it("renders the all-mastered banner", () => {
    renderWithIntl(<MilestoneShareButton milestone={allMasteredMilestone} />, {
      locale,
    });
    expect(screen.getByText(EXPECTED[locale].all)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Share text (clipboard fallback path)
// ---------------------------------------------------------------------------

describe.each(LOCALES)(
  "MilestoneShareButton share text - %s locale",
  (locale) => {
    afterEach(() => {
      vi.restoreAllMocks();
      try {
        Object.defineProperty(navigator, "clipboard", {
          value: undefined,
          configurable: true,
        });
      } catch {
        // ignore - may not be configurable on some jsdom versions
      }
    });

    it("copies the localised share text to the clipboard", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      renderWithIntl(<MilestoneShareButton milestone={countMilestone} />, {
        locale,
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button"));
      });

      expect(writeText).toHaveBeenCalledWith(EXPECTED[locale].shareCount);
    });
  },
);
