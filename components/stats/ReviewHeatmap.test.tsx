/**
 * Smoke tests for ReviewHeatmap.
 *
 * Exercises the component's render path so the `cardPanel` class-name
 * refactor on the wrapper div is instrumented by the coverage gate.
 * Also covers the hover-tooltip interaction added in #1063.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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

describe("ReviewHeatmap", () => {
  it("renders the Review activity heading", () => {
    render(<ReviewHeatmap columns={makeEmptyColumns()} />);
    expect(
      screen.getByRole("heading", { name: /review activity/i }),
    ).toBeInTheDocument();
  });

  it("shows total review count in the summary line", () => {
    render(<ReviewHeatmap columns={makeEmptyColumns()} />);
    // Zero reviews → "0 reviews in the last year"
    expect(screen.getByText(/0 reviews in the last year/)).toBeInTheDocument();
  });

  it("renders an SVG heatmap image", () => {
    render(<ReviewHeatmap columns={makeEmptyColumns()} />);
    expect(
      screen.getByRole("img", { name: /heatmap/i }),
    ).toBeInTheDocument();
  });

  it("does not show a tooltip before hovering", () => {
    render(<ReviewHeatmap columns={makeColumnsWithReviews()} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows a tooltip with date and review count on mouseEnter", () => {
    render(<ReviewHeatmap columns={makeColumnsWithReviews()} />);

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
    render(<ReviewHeatmap columns={makeColumnsWithReviews()} />);

    const svg = screen.getByRole("img", { name: /heatmap/i });
    const rects = svg.querySelectorAll("rect");
    const firstRect = rects[0];

    fireEvent.mouseEnter(firstRect, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(svg);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
