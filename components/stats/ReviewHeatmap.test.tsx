/**
 * Smoke tests for ReviewHeatmap.
 *
 * Exercises the component's render path so the `cardPanel` class-name
 * refactor on the wrapper div is instrumented by the coverage gate.
 * Also covers the hover-tooltip interaction added in #1063.
 *
 * Updated in #1408 to use renderWithIntl (component now calls useTranslations /
 * useFormatter) and to assert locale-correct number formatting.
 */

import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { ReviewHeatmap } from "@/components/stats/ReviewHeatmap";
import type { HeatmapCell } from "@/lib/stats/heatmap";

/** Build a minimal 53-column × 7-row grid of zeroed cells. */
function makeEmptyColumns(): readonly (readonly HeatmapCell[])[] {
  return Array.from({ length: 53 }, (_, col) =>
    Array.from({ length: 7 }, (__, row) => ({
      date: `2026-01-${String((col * 7 + row + 1) % 28 || 1).padStart(2, "0")}`,
      count: 0,
    })),
  );
}

/** Build columns with a non-zero count on the first cell. */
function makeColumnsWithReviews(): readonly (readonly HeatmapCell[])[] {
  const cols = makeEmptyColumns() as HeatmapCell[][];
  // Place 5 reviews on the first cell (col 0, row 0).
  (cols[0] as HeatmapCell[])[0] = { date: "2026-01-01", count: 5 };
  return cols;
}

/** Build columns with a fixed total review count spread across multiple cells. */
function makeColumnsWithCount(total: number): readonly (readonly HeatmapCell[])[] {
  const cols = makeEmptyColumns() as HeatmapCell[][];
  // Put all reviews in cell [0][0] for simplicity.
  (cols[0] as HeatmapCell[])[0] = { date: "2026-01-01", count: total };
  return cols;
}

describe("ReviewHeatmap", () => {
  it("renders the Review activity heading", () => {
    renderWithIntl(<ReviewHeatmap columns={makeEmptyColumns()} />);
    expect(
      screen.getByRole("heading", { name: /review activity/i }),
    ).toBeInTheDocument();
  });

  it("shows total review count in the summary line (en)", () => {
    renderWithIntl(<ReviewHeatmap columns={makeEmptyColumns()} />);
    // Zero reviews → "0 reviews in the last year"
    expect(screen.getByText(/0 reviews in the last year/)).toBeInTheDocument();
  });

  it("shows localised number in summary line (ja, 1000 reviews)", () => {
    const cols = makeColumnsWithCount(1000);
    renderJa(<ReviewHeatmap columns={cols} />);
    // Japanese uses commas for grouping same as en: "1,000"
    // Multiple elements may contain "1,000" (headline + SVG title); use
    // getAllByText and assert at least one is present.
    const matches = screen.getAllByText(/1,000/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders an SVG heatmap image", () => {
    renderWithIntl(<ReviewHeatmap columns={makeEmptyColumns()} />);
    expect(
      screen.getByRole("img", { name: /heatmap/i }),
    ).toBeInTheDocument();
  });

  it("does not show a tooltip before hovering", () => {
    renderWithIntl(<ReviewHeatmap columns={makeColumnsWithReviews()} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows a tooltip with date and review count on mouseEnter", () => {
    renderWithIntl(<ReviewHeatmap columns={makeColumnsWithReviews()} />);

    // The SVG has 53×7 = 371 rect cells. The first rect corresponds to col 0 / row 0
    // which we set to 5 reviews on 2026-01-01.
    const svg = screen.getByRole("img", { name: /heatmap/i });
    const rects = svg.querySelectorAll("rect");
    const firstRect = rects[0];
    expect(firstRect).toBeDefined();

    fireEvent.mouseEnter(firstRect, { clientX: 10, clientY: 10 });

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    // Should mention the date and the review count.
    expect(tooltip.textContent).toMatch(/2026/);
    expect(tooltip.textContent).toMatch(/5 review/);
  });

  it("hides the tooltip after mouseleave on the SVG", () => {
    renderWithIntl(<ReviewHeatmap columns={makeColumnsWithReviews()} />);

    const svg = screen.getByRole("img", { name: /heatmap/i });
    const rects = svg.querySelectorAll("rect");
    const firstRect = rects[0];

    fireEvent.mouseEnter(firstRect, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(svg);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // Locale-rendering tests for the date migration (#1456).
  // formatDate always uses en-GB ordering (day-month-year) regardless of
  // appLocale - verifying the year appears in all four supported locales
  // confirms the route through the shared helper is stable.
  describe("date tooltip renders in all supported locales", () => {
    function triggerTooltip() {
      const svg = screen.getByRole("img", { name: /heatmap/i });
      const rects = svg.querySelectorAll("rect");
      fireEvent.mouseEnter(rects[0]!, { clientX: 10, clientY: 10 });
      return screen.getByRole("tooltip");
    }

    it("en: tooltip shows year", () => {
      renderWithIntl(<ReviewHeatmap columns={makeColumnsWithReviews()} />);
      const tooltip = triggerTooltip();
      expect(tooltip.textContent).toMatch(/2026/);
      expect(tooltip.textContent).toMatch(/Jan/);
    });

    it("ja: tooltip still shows en-GB date (formatDate is locale-stable)", () => {
      renderJa(<ReviewHeatmap columns={makeColumnsWithReviews()} />);
      const tooltip = triggerTooltip();
      // formatDate uses en-GB regardless of appLocale, so the date is
      // always an English month name + year.
      expect(tooltip.textContent).toMatch(/2026/);
      expect(tooltip.textContent).toMatch(/Jan/);
    });

    it("zh-Hans: tooltip still shows en-GB date", () => {
      renderZhHans(<ReviewHeatmap columns={makeColumnsWithReviews()} />);
      const tooltip = triggerTooltip();
      expect(tooltip.textContent).toMatch(/2026/);
      expect(tooltip.textContent).toMatch(/Jan/);
    });

    it("zh-Hant: tooltip still shows en-GB date", () => {
      renderZhHant(<ReviewHeatmap columns={makeColumnsWithReviews()} />);
      const tooltip = triggerTooltip();
      expect(tooltip.textContent).toMatch(/2026/);
      expect(tooltip.textContent).toMatch(/Jan/);
    });
  });
});
