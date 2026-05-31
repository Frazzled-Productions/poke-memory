/**
 * Smoke tests for AccuracySparkline.
 *
 * Exercises both the card-panel wrapper (always rendered) and the empty-state
 * paragraph so the `cn()` / `mutedText` class-name refactor on those lines is
 * instrumented by the coverage gate.
 */

import { describe, it, expect } from "vitest";
import { renderWithIntl as render, screen } from "@/components/test-utils/renderWithIntl";
import { AccuracySparkline } from "@/components/stats/AccuracySparkline";
import type { AccuracyPoint } from "@/lib/stats/accuracy";

describe("AccuracySparkline", () => {
  it("renders the Recent accuracy heading", () => {
    render(
      <AccuracySparkline points={[]} rolling7d={null} />,
    );
    expect(
      screen.getByRole("heading", { name: /recent accuracy/i }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message when there are no reviews (line 190)", () => {
    render(
      <AccuracySparkline points={[]} rolling7d={null} />,
    );
    // Default window is 7d, so the empty-state message references 7 days.
    expect(
      screen.getByText(/no reviews yet in the last 7 days/i),
    ).toBeInTheDocument();
  });

  it("renders the rolling-accuracy card panel (line 148) with data", () => {
    const point: AccuracyPoint = {
      date: "2026-05-01",
      total: 10,
      passes: 8,
      accuracy: 0.8,
    };
    render(
      <AccuracySparkline
        points={[point]}
        rolling7d={0.8}
      />,
    );
    // The formatted percentage should appear in the headline stat.
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("renders a window-selector tab list", () => {
    render(
      <AccuracySparkline points={[]} rolling7d={null} />,
    );
    expect(screen.getByRole("tablist", { name: /accuracy window/i })).toBeInTheDocument();
  });
});
