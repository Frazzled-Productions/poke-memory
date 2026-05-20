import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FirstMasteryHint } from "./FirstMasteryHint";

describe("FirstMasteryHint", () => {
  it("renders the day count with hedged wording", () => {
    render(<FirstMasteryHint days={20} />);
    const hint = screen.getByTestId("first-mastery-hint");
    expect(hint.textContent).toContain("First mastery in roughly");
    expect(hint.textContent).toContain("20");
    expect(hint.textContent).toContain("days");
    expect(hint.textContent).toContain("if you keep reviewing daily");
  });

  it("uses the singular 'day' when days is 1", () => {
    render(<FirstMasteryHint days={1} />);
    const hint = screen.getByTestId("first-mastery-hint");
    // "1 day" not "1 days"
    expect(hint.textContent).toMatch(/1 day\b/);
    expect(hint.textContent).not.toMatch(/1 days/);
  });

  it("explains the mastery threshold without false precision", () => {
    render(<FirstMasteryHint days={28} />);
    const text = screen.getByTestId("first-mastery-hint").textContent ?? "";
    // British-English hedging, no em dashes.
    expect(text).not.toContain("—");
    // The threshold explainer mentions the 21-day interval and the three
    // successful reviews so the user knows what bar they are aiming at.
    expect(text).toContain("21");
    expect(text).toContain("three");
  });
});
