/**
 * Smoke tests for RecordsCard.
 *
 * Exercises the component's render path so the `cn()` class-name refactor
 * on the records grid wrapper is instrumented by the coverage gate.
 */

import { describe, it, expect } from "vitest";
import { renderWithIntl, screen } from "@/components/test-utils/renderWithIntl";
import { RecordsCard } from "@/components/stats/RecordsCard";
import type { Records } from "@/lib/stats/records";

const baseRecords: Records = {
  longestStreak: 7,
  bestReviewDay: 42,
  avgDaysToMastery: 14,
  mostMasteredIn7d: 5,
};

describe("RecordsCard", () => {
  it("renders the Records heading", () => {
    renderWithIntl(<RecordsCard records={baseRecords} />);
    expect(
      screen.getByRole("heading", { name: /records/i }),
    ).toBeInTheDocument();
  });

  it("displays the longest-streak value", () => {
    renderWithIntl(<RecordsCard records={baseRecords} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows singular label when longestStreak is 1", () => {
    renderWithIntl(<RecordsCard records={{ ...baseRecords, longestStreak: 1 }} />);
    expect(screen.getByText(/day longest streak/)).toBeInTheDocument();
  });

  it("renders a dash when avgDaysToMastery is null", () => {
    renderWithIntl(
      <RecordsCard records={{ ...baseRecords, avgDaysToMastery: null }} />,
    );
    // fmt() returns "—" for null values.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
