import { describe, it, expect, vi } from "vitest";
import { UndoButton, ReviewCardLayout } from "@/components/review/ReviewCardLayout";
import {
  renderWithIntl,
  renderJa,
  screen,
} from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// UndoButton
// ---------------------------------------------------------------------------

describe("UndoButton", () => {
  it("renders the undo label in English", () => {
    renderWithIntl(<UndoButton onClick={() => {}} />);

    // Visible text: "Undo last grade (⌘Z)"
    expect(screen.getByText(/undo last grade/i)).toBeInTheDocument();
    // Accessible name: "Undo last grade"
    expect(
      screen.getByRole("button", { name: /undo last grade/i }),
    ).toBeInTheDocument();
  });

  it("calls onClick when the undo button is clicked", async () => {
    const onClick = vi.fn();
    const { getByRole } = renderWithIntl(<UndoButton onClick={onClick} />);

    getByRole("button", { name: /undo last grade/i }).click();

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders the undo label in Japanese", () => {
    // ja.json: undoLastGrade = "最後の採点を取り消す (⌘Z)"
    //          undoLastGradeAriaLabel = "最後の採点を取り消す"
    renderJa(<UndoButton onClick={() => {}} />);

    expect(screen.getByText(/最後の採点を取り消す/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "最後の採点を取り消す" }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ReviewCardLayout - out-of-scope hint
// ---------------------------------------------------------------------------

describe("ReviewCardLayout - out-of-scope hint", () => {
  const baseProps = {
    variant: "flip" as const,
    cardRegion: <div>card</div>,
    showOutOfScopeHint: false,
    queueCounts: { newCount: 0, learningCount: 0, reviewCount: 0 },
    hasUndoSnapshot: false,
    onUndo: () => {},
  };

  it("does NOT render the out-of-scope hint when showOutOfScopeHint is false", () => {
    renderWithIntl(<ReviewCardLayout {...baseProps} showOutOfScopeHint={false} />);

    // The out-of-scope hint text should not appear.
    expect(screen.queryByText(/finishing an in-progress card/i)).not.toBeInTheDocument();
  });

  it("renders the out-of-scope hint when showOutOfScopeHint is true", () => {
    renderWithIntl(<ReviewCardLayout {...baseProps} showOutOfScopeHint={true} />);

    expect(screen.getByText(/finishing an in-progress card/i)).toBeInTheDocument();
  });

  it("renders the out-of-scope hint in Japanese", () => {
    // ja.json: outOfScopeHint = "進行中のカードを仕上げています"
    renderJa(<ReviewCardLayout {...baseProps} showOutOfScopeHint={true} />);

    expect(screen.getByText("進行中のカードを仕上げています")).toBeInTheDocument();
  });
});
