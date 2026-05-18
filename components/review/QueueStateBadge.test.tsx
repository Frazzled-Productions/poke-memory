import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { QueueStateBadge } from "@/components/review/QueueStateBadge";
import type { ReviewState } from "@/lib/srs/scheduler";

function makeState(overrides: Partial<ReviewState>): ReviewState {
  return {
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    fsrsState: "new",
    dueDate: "2026-01-01",
    lastReview: null,
    firstSeen: null,
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

describe("QueueStateBadge", () => {
  it('renders "New" for a card never reviewed', () => {
    render(<QueueStateBadge state={makeState({ lastReview: null, learningStep: null })} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: New");
  });

  it('renders "Learning" when learningStep is non-null', () => {
    render(<QueueStateBadge state={makeState({ learningStep: 0, stepStartedAt: Date.now() })} />);
    expect(screen.getByText("Learning")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: Learning");
  });

  it('renders "Review" for a graduated card with a prior review', () => {
    render(
      <QueueStateBadge
        state={makeState({
          lastReview: "2026-01-01",
          learningStep: null,
          reps: 3,
          stability: 10,
          fsrsState: "review",
        })}
      />,
    );
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: Review");
  });
});
