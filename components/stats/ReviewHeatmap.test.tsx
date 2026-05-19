/**
 * Smoke tests for ReviewHeatmap.
 *
 * Exercises the component's render path so the `cardPanel` class-name
 * refactor on the wrapper div is instrumented by the coverage gate.
 */

import { render, screen } from "@testing-library/react";
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
});
