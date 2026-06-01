/**
 * StatusChips tests — the shared streak / token / mastery pills used by both
 * ProfileStatusBar and StreakBadge (single source of truth).
 *
 * Covers: terse visible label + full aria-label, the streak-0 and token-0
 * edge states, the encouraging zero-mastery label, and locale rendering.
 */

import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";
import { StreakChip, TokenChip, MasteryChip } from "./StatusChips";

describe("StreakChip", () => {
  it("renders the terse day count with a full aria-label", () => {
    renderWithIntl(<StreakChip streak={7} />);
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByLabelText(/7 day streak/i)).toBeInTheDocument();
  });

  it("shows the start-streak prompt at zero", () => {
    renderWithIntl(<StreakChip streak={0} />);
    expect(screen.getByText(/start streak/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/start your streak/i)).toBeInTheDocument();
  });
});

describe("TokenChip", () => {
  it("renders the terse count with a full aria-label when balance >= 1", () => {
    renderWithIntl(<TokenChip tokenBalance={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByLabelText(/2 protection tokens/i)).toBeInTheDocument();
  });

  it("renders nothing when the balance is 0", () => {
    const { container } = renderWithIntl(<TokenChip tokenBalance={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MasteryChip", () => {
  it("renders the percentage with a count-bearing aria-label", () => {
    renderWithIntl(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    const chip = screen.getByLabelText(/143 of 1025/i);
    expect(chip.textContent).toMatch(/14.*%/);
  });

  it("uses an encouraging aria-label at zero mastery", () => {
    renderWithIntl(
      <MasteryChip masteryCount={0} totalSpecies={1025} masteryPercent={0} />,
    );
    expect(
      screen.getByLabelText(/0 of 1025.*start reviewing/i),
    ).toBeInTheDocument();
  });
});

describe("StatusChips — locale", () => {
  it("ja: token aria-label renders in Japanese", () => {
    renderJa(<TokenChip tokenBalance={2} />);
    // tokenChipAriaLabel (ja) contains "保護トークン".
    expect(screen.getByLabelText(/保護トークン/)).toBeInTheDocument();
  });

  it("ja: mastery aria-label renders in Japanese", () => {
    renderJa(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    expect(screen.getByLabelText(/習得済み/)).toBeInTheDocument();
  });
});
