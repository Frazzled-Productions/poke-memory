import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FirstMasteryHint } from "./FirstMasteryHint";

describe("FirstMasteryHint", () => {
  it("renders the day count with hedged wording", () => {
    render(<FirstMasteryHint days={20} masteryReps={3} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    expect(hint.textContent).toContain("First mastery in roughly");
    expect(hint.textContent).toContain("20");
    expect(hint.textContent).toContain("days");
    expect(hint.textContent).toContain("if you keep reviewing daily");
  });

  it("uses the singular 'day' when days is 1", () => {
    render(<FirstMasteryHint days={1} masteryReps={3} masteryDays={21} />);
    const hint = screen.getByTestId("first-mastery-hint");
    // "1 day" not "1 days"
    expect(hint.textContent).toMatch(/1 day\b/);
    expect(hint.textContent).not.toMatch(/1 days/);
  });

  it("explains the mastery threshold without false precision", () => {
    render(<FirstMasteryHint days={28} masteryReps={3} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    // British-English hedging, no em dashes.
    expect(text).not.toContain("—");
    // The threshold explainer mentions the 21-day interval and the three
    // successful reviews so the user knows what bar they are aiming at.
    expect(text).toContain("21");
    expect(text).toContain("three");
  });

  it("interpolates a custom masteryReps value into the copy", () => {
    // A user who has bumped the mastery threshold up to five reps should see
    // the hint reflect that — no hardcoded "three".
    render(<FirstMasteryHint days={28} masteryReps={5} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("five successful reviews");
    expect(text).not.toContain("three successful");
  });

  it("uses singular 'review' when masteryReps is 1", () => {
    render(<FirstMasteryHint days={10} masteryReps={1} masteryDays={21} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("one successful review");
    expect(text).not.toContain("one successful reviews");
  });

  it("interpolates a custom masteryDays interval into the copy", () => {
    render(<FirstMasteryHint days={28} masteryReps={3} masteryDays={28} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    expect(text).toContain("28-day interval");
    expect(text).not.toContain("21-day interval");
  });
});
