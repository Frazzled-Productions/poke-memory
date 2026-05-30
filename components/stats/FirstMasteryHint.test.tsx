/**
 * Tests for FirstMasteryHint — updated in #1408 to use renderWithIntl
 * (component now calls useTranslations) and to reflect the removal of
 * English-only spellOutSmall (replaced by ICU plural `#` format).
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
    renderWithIntl(<FirstMasteryHint days={20} masteryReps={3} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    expect(hint.textContent).toContain("First mastery in roughly");
    expect(hint.textContent).toContain("20");
    expect(hint.textContent).toContain("days");
    expect(hint.textContent).toContain("if you keep reviewing daily");
  });

  it("uses the singular 'day' when days is 1", () => {
    renderWithIntl(<FirstMasteryHint days={1} masteryReps={3} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    // "1 day" not "1 days"
    expect(hint.textContent).toMatch(/1 day\b/);
    expect(hint.textContent).not.toMatch(/1 days/);
  });

  it("explains the mastery threshold without false precision", () => {
    renderWithIntl(<FirstMasteryHint days={28} masteryReps={3} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    // British-English hedging, no em dashes.
    expect(text).not.toContain("—");
    // The threshold explainer mentions the 21-day interval.
    expect(text).toContain("21");
    // Note: spellOutSmall removed in #1408 — reps are now rendered as digits.
    expect(text).toContain("3");
  });

  it("interpolates a custom masteryReps value into the copy (en, plural)", () => {
    // A user who has bumped the mastery threshold up to five reps should see
    // "5 successful reviews" (digit form, not spelled out, since spellOutSmall
    // was removed in #1408 as it was English-only).
    renderWithIntl(<FirstMasteryHint days={28} masteryReps={5} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("5 successful reviews");
  });

  it("uses singular 'review' when masteryReps is 1 (en)", () => {
    renderWithIntl(<FirstMasteryHint days={10} masteryReps={1} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("1 successful review");
    expect(text).not.toContain("1 successful reviews");
  });

  it("interpolates a custom masteryDays interval into the copy", () => {
    renderWithIntl(<FirstMasteryHint days={28} masteryReps={3} masteryDays={28} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("28-day interval");
    expect(text).not.toContain("21-day interval");
  });

  // --- Locale coverage (#1408) ---

  it("renders in Japanese (ja) without throwing", () => {
    renderJa(<FirstMasteryHint days={20} masteryReps={3} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    expect(hint).toBeInTheDocument();
    // Day count should appear in the output
    expect(hint.textContent).toContain("20");
  });
});
