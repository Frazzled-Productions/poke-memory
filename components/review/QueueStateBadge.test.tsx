import { describe, it, expect } from "vitest";
import { renderWithIntl, screen } from "@/components/test-utils/renderWithIntl";
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
    renderWithIntl(<QueueStateBadge state={makeState({ lastReview: null, learningStep: null })} />);
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: New");
  });

  it('renders "Learning" when learningStep is non-null', () => {
    renderWithIntl(<QueueStateBadge state={makeState({ learningStep: 0, stepStartedAt: Date.now() })} />);
    expect(screen.getByText("Learning")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: Learning");
  });

  it('renders "Review" for a graduated card with a prior review', () => {
    renderWithIntl(
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

  it('suppresses "Learning" and shows "New" when forceCardsGraduated is true and card has no prior review', () => {
    renderWithIntl(
      <QueueStateBadge
        state={makeState({ learningStep: 0, stepStartedAt: Date.now(), lastReview: null })}
        forceCardsGraduated
      />,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText("Learning")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: New");
  });

  it('suppresses "Learning" and shows "Review" when forceCardsGraduated is true and card has a prior review', () => {
    renderWithIntl(
      <QueueStateBadge
        state={makeState({
          learningStep: 1,
          stepStartedAt: Date.now(),
          lastReview: "2026-01-01",
          reps: 2,
        })}
        forceCardsGraduated
      />,
    );
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.queryByText("Learning")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Card queue state: Review");
  });

  it('still renders "Learning" when forceCardsGraduated is false', () => {
    renderWithIntl(
      <QueueStateBadge
        state={makeState({ learningStep: 0, stepStartedAt: Date.now() })}
        forceCardsGraduated={false}
      />,
    );
    expect(screen.getByText("Learning")).toBeInTheDocument();
  });
});
