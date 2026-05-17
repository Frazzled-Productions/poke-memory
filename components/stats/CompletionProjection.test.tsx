import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompletionProjection } from "./CompletionProjection";

describe("CompletionProjection — insufficient-history empty state", () => {
  it("shows the updated heading (not the old 'Not enough data yet' copy)", () => {
    render(<CompletionProjection projection={{ kind: "insufficient-history" }} />);
    expect(screen.getByText("Projection not available yet")).toBeInTheDocument();
    expect(screen.queryByText("Not enough data yet")).toBeNull();
  });

  it("surfaces the mastery and minimum-history unlock requirements", () => {
    render(<CompletionProjection projection={{ kind: "insufficient-history" }} />);
    // Explains both the mastery prerequisite and the 7-day wait.
    const desc = screen.getByText(/master.*species.*7 days/i);
    expect(desc).toBeInTheDocument();
  });
});

describe("CompletionProjection — complete state", () => {
  it("shows the congratulations message", () => {
    render(<CompletionProjection projection={{ kind: "complete" }} />);
    expect(screen.getByText("Complete!")).toBeInTheDocument();
    expect(screen.getByText(/every species/i)).toBeInTheDocument();
  });
});

describe("CompletionProjection — projected state", () => {
  it("shows the projected date, remaining count, and weekly rate", () => {
    render(
      <CompletionProjection
        projection={{
          kind: "projected",
          projectedDate: "2026-12-25",
          weeklyRate: 3.5,
          remaining: 200,
        }}
        fmt="dmy"
        tz="UTC"
      />,
    );
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("3.5")).toBeInTheDocument();
    expect(screen.getByText(/species remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/mastered per week/i)).toBeInTheDocument();
  });
});
