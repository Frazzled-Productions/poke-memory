import { describe, it, expect } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, renderJa, renderZhHans, renderZhHant, screen } from "@/components/test-utils/renderWithIntl";
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

// ---------------------------------------------------------------------------
// QueueStateBadge - InfoButton (#1574)
// ---------------------------------------------------------------------------

describe("QueueStateBadge - InfoButton", () => {
  it("renders an InfoButton alongside the queue badge", () => {
    renderWithIntl(<QueueStateBadge state={makeState({})} />);
    expect(
      screen.getByRole("button", { name: "About queue states" }),
    ).toBeInTheDocument();
  });

  it("InfoButton starts with aria-expanded=false and panel hidden", () => {
    renderWithIntl(<QueueStateBadge state={makeState({})} />);
    const btn = screen.getByRole("button", { name: "About queue states" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/you have not reviewed this card yet/i)).not.toBeInTheDocument();
  });

  it("clicking InfoButton opens the explanation panel", async () => {
    const user = userEvent.setup();
    renderWithIntl(<QueueStateBadge state={makeState({})} />);
    await user.click(screen.getByRole("button", { name: "About queue states" }));
    // Panel lists all three queue-state explanations.
    expect(screen.getByText(/you have not reviewed this card yet/i)).toBeInTheDocument();
    expect(screen.getByText(/short-interval learning steps/i)).toBeInTheDocument();
    // "infoReview" mentions "graduated into long-term review" - distinct from the learning text.
    expect(screen.getByText(/graduated into long-term review/i)).toBeInTheDocument();
  });

  it("panel closes on second click", async () => {
    const user = userEvent.setup();
    renderWithIntl(<QueueStateBadge state={makeState({})} />);
    const btn = screen.getByRole("button", { name: "About queue states" });
    await user.click(btn);
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/you have not reviewed this card yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/short-interval learning steps/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// QueueStateBadge - InfoButton locale coverage (#1574)
// ---------------------------------------------------------------------------

describe("QueueStateBadge - InfoButton in Japanese", () => {
  it("renders InfoButton with Japanese aria-label", () => {
    renderJa(<QueueStateBadge state={makeState({})} />);
    // messages/ja.json review.queue.infoAriaLabel = "キュー状態について"
    expect(
      screen.getByRole("button", { name: "キュー状態について" }),
    ).toBeInTheDocument();
  });
});

describe("QueueStateBadge - InfoButton in Simplified Chinese", () => {
  it("renders InfoButton with Simplified Chinese aria-label", () => {
    renderZhHans(<QueueStateBadge state={makeState({})} />);
    // messages/zh-Hans.json review.queue.infoAriaLabel = "关于队列状态"
    expect(
      screen.getByRole("button", { name: "关于队列状态" }),
    ).toBeInTheDocument();
  });
});

describe("QueueStateBadge - InfoButton in Traditional Chinese", () => {
  it("renders InfoButton with Traditional Chinese aria-label", () => {
    renderZhHant(<QueueStateBadge state={makeState({})} />);
    // messages/zh-Hant.json review.queue.infoAriaLabel = "關於佇列狀態"
    expect(
      screen.getByRole("button", { name: "關於佇列狀態" }),
    ).toBeInTheDocument();
  });
});
