/**
 * Smoke tests for RecordsCard.
 *
 * Exercises the component's render path so the `cn()` class-name refactor
 * on the records grid wrapper is instrumented by the coverage gate.
 */

import { describe, it, expect } from "vitest";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
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
    // fmt() returns " - " for null values.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Locale coverage (mandatory per AGENTS.md - #1393)
// ---------------------------------------------------------------------------

describe("RecordsCard - Japanese locale (#1393)", () => {
  it("renders the Japanese heading in ja locale", () => {
    renderJa(<RecordsCard records={baseRecords} />);
    // ja stats.records.heading = "記録"
    expect(screen.getByRole("heading", { name: "記録" })).toBeInTheDocument();
  });

  it("renders the Japanese best-review-day label in ja locale", () => {
    renderJa(<RecordsCard records={baseRecords} />);
    // ja stats.records.bestReviewDay = "最多レビュー日"
    expect(screen.getByText("最多レビュー日")).toBeInTheDocument();
  });
});
