/**
 * Tests for FirstMasteryHint - updated in #1765 to reflect removal of
 * masteryReps prop (the reps gate is gone; mastery now uses stability >= 21).
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
} from "@/components/test-utils/renderWithIntl";
import { FirstMasteryHint } from "./FirstMasteryHint";

describe("FirstMasteryHint", () => {
  it("renders the day count with hedged wording", () => {
    renderWithIntl(<FirstMasteryHint days={20} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    expect(hint.textContent).toContain("First mastery in roughly");
    expect(hint.textContent).toContain("20");
    expect(hint.textContent).toContain("days");
    expect(hint.textContent).toContain("if you keep reviewing daily");
  });

  it("uses the singular 'day' when days is 1", () => {
    renderWithIntl(<FirstMasteryHint days={1} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    // "1 day" not "1 days"
    expect(hint.textContent).toMatch(/1 day\b/);
    expect(hint.textContent).not.toMatch(/1 days/);
  });

  it("explains the mastery threshold (stability-days) without false precision", () => {
    renderWithIntl(<FirstMasteryHint days={28} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    // British-English hedging, no em dashes.
    expect(text).not.toContain("—");
    // The threshold explainer mentions the 21-day stability.
    expect(text).toContain("21");
  });

  it("interpolates a custom masteryDays value into the copy", () => {
    renderWithIntl(<FirstMasteryHint days={28} masteryDays={28} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("28");
    // The text includes "28-day stability" for the 28-day threshold.
    expect(text).toContain("28-day stability");
    expect(text).not.toContain("21-day stability");
  });

  it("renders with masteryDays=21 and mentions stability", () => {
    renderWithIntl(<FirstMasteryHint days={14} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("21-day stability");
  });

  // --- Locale coverage (#1408) ---

  it("renders in Japanese (ja) without throwing", () => {
    renderJa(<FirstMasteryHint days={20} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    expect(hint).toBeInTheDocument();
    // Day count should appear in the output
    expect(hint.textContent).toContain("20");
  });
});
