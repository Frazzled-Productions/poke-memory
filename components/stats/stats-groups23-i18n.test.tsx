/**
 * Locale-coverage tests for the Group-2 and Group-3 stats surfaces swept in
 * #1434 PR2.
 *
 * Mandatory coverage rule (AGENTS.md "Mandatory coverage rules"): every
 * component that renders user-facing text must be exercised in all four
 * supported locales (en, ja, zh-Hans, zh-Hant). Groups 4 and 5 each shipped a
 * dedicated `*-i18n.test.tsx`; these seven components (translated in Groups 2
 * and 3) had no equivalent, so a broken `t()` wiring on any of them would pass
 * unit tests + `lint:i18n` and only surface in the browser.
 *
 * Each component renders its section heading from the catalogue, so asserting
 * the localised heading appears proves the next-intl wiring resolves in every
 * locale.
 *
 * Test project: jsdom (components/**).
 *
 * Refs: AGENTS.md "Mandatory coverage rules", closes #1434.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import type { AppLocale } from "@/i18n/locales";

import { AccuracySparkline } from "@/components/stats/AccuracySparkline";
import { GradeDistributionChart } from "@/components/stats/GradeDistributionChart";
import { MasteryOverTimeChart } from "@/components/stats/MasteryOverTimeChart";
import { GradeBreakdownBar } from "@/components/stats/GradeBreakdownBar";
import { CompletionProjection } from "@/components/stats/CompletionProjection";
import { GameBreakdown } from "@/components/stats/GameBreakdown";
import { TypeBreakdown } from "@/components/stats/TypeBreakdown";
import type { GameStats } from "@/lib/stats/per-game";
import type { TypeStats } from "@/lib/stats/derive";
import type { GradeDistribution } from "@/lib/stats/grade-distribution";

// ---------------------------------------------------------------------------
// Recharts mock — GradeDistributionChart (BarChart) and MasteryOverTimeChart
// (AreaChart) render through recharts, which needs ResizeObserver that jsdom
// cannot satisfy. Lightweight stubs let both components run their own JSX.
// ---------------------------------------------------------------------------

vi.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: () => null,
  XAxis: ({ className }: { className?: string }) => (
    <div data-testid="x-axis" className={className} />
  ),
  YAxis: ({ className }: { className?: string }) => (
    <div data-testid="y-axis" className={className} />
  ),
}));

// ---------------------------------------------------------------------------
// Locale render helpers
// ---------------------------------------------------------------------------

const LOCALE_RENDER: Record<AppLocale, typeof renderWithIntl> = {
  en: renderWithIntl,
  ja: renderJa,
  "zh-Hans": renderZhHans,
  "zh-Hant": renderZhHant,
};

const LOCALES = Object.keys(LOCALE_RENDER) as AppLocale[];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EMPTY_DISTRIBUTION: GradeDistribution = {
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
  total: 0,
};
const RED_BLUE: GameStats = { slug: "red-blue", total: 151, introduced: 50, mastered: 10 };
const FIRE_TYPE: TypeStats = { type: "fire", total: 10, introduced: 5, mastered: 2 };

// Each entry: component renderer + its catalogue heading per locale. The
// heading is rendered in every state, so a minimal/empty fixture is enough to
// prove the wiring resolves.
const CASES: ReadonlyArray<{
  name: string;
  render: () => React.ReactElement;
  headings: Record<AppLocale, string>;
}> = [
  {
    name: "AccuracySparkline",
    render: () => <AccuracySparkline points={[]} rolling7d={null} />,
    headings: {
      en: "Recent accuracy",
      ja: "最近の正解率",
      "zh-Hans": "近期正确率",
      "zh-Hant": "近期正確率",
    },
  },
  {
    name: "GradeDistributionChart",
    render: () => <GradeDistributionChart distribution={EMPTY_DISTRIBUTION} trend={[]} />,
    headings: {
      en: "Grade distribution",
      ja: "評価の分布",
      "zh-Hans": "评分分布",
      "zh-Hant": "評分分佈",
    },
  },
  {
    name: "MasteryOverTimeChart",
    render: () => <MasteryOverTimeChart series={[]} totalCards={100} />,
    headings: {
      en: "Mastery over time",
      ja: "習得数の推移",
      "zh-Hans": "掌握数量变化",
      "zh-Hant": "掌握數量變化",
    },
  },
  {
    name: "GradeBreakdownBar",
    render: () => <GradeBreakdownBar again={1} hard={1} good={1} easy={1} />,
    headings: {
      en: "Grade breakdown",
      ja: "評価の内訳",
      "zh-Hans": "评分分布",
      "zh-Hant": "評分分佈",
    },
  },
  {
    name: "CompletionProjection",
    render: () => <CompletionProjection projection={{ kind: "insufficient-history" }} />,
    headings: {
      en: "Pokédex completion",
      ja: "図鑑完成予測",
      "zh-Hans": "图鉴完成预测",
      "zh-Hant": "圖鑑完成預測",
    },
  },
  {
    name: "GameBreakdown",
    render: () => <GameBreakdown perGame={[RED_BLUE]} />,
    headings: {
      en: "By game",
      ja: "ゲーム別",
      "zh-Hans": "按游戏",
      "zh-Hant": "按遊戲",
    },
  },
  {
    name: "TypeBreakdown",
    render: () => <TypeBreakdown perType={[FIRE_TYPE]} />,
    headings: {
      en: "By type",
      ja: "タイプ別",
      "zh-Hans": "按属性",
      "zh-Hant": "按屬性",
    },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.each(CASES)("$name — locale coverage", ({ render, headings }) => {
  it.each(LOCALES)("renders its heading in %s", (locale) => {
    LOCALE_RENDER[locale](render());
    expect(
      screen.getByRole("heading", { name: headings[locale] }),
    ).toBeInTheDocument();
  });
});
