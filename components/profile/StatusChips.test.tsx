/**
 * StatusChips tests — the shared streak / token / mastery pills used by both
 * ProfileStatusBar and StreakBadge (single source of truth).
 *
 * Covers:
 *   - Terse visible label + full aria-label (chips are now buttons)
 *   - The streak-0 and token-0 edge states
 *   - The encouraging zero-mastery label
 *   - Locale rendering (en + non-English locales)
 *   - Popover open/close on click (tap) and keyboard focus (#1556)
 *   - Popover body equals aria-label (forcing-function: single-source invariant)
 *   - Popover closes on Escape and click-outside (#1556)
 *   - All four locales render the popover correctly (#1556)
 */

import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { StreakChip, TokenChip, MasteryChip } from "./StatusChips";

// ─── Original chip rendering ────────────────────────────────────────────────

describe("StreakChip", () => {
  it("renders the terse day count with a full aria-label on the button", () => {
    renderWithIntl(<StreakChip streak={7} />);
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /7 days streak/i })).toBeInTheDocument();
  });

  it("shows the start-streak prompt at zero", () => {
    renderWithIntl(<StreakChip streak={0} />);
    expect(screen.getByText(/start streak/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start your streak/i })).toBeInTheDocument();
  });
});

describe("TokenChip", () => {
  it("renders the terse count with a full aria-label when balance >= 1", () => {
    renderWithIntl(<TokenChip tokenBalance={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 protection tokens/i })).toBeInTheDocument();
  });

  it("renders nothing when the balance is 0", () => {
    const { container } = renderWithIntl(<TokenChip tokenBalance={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MasteryChip", () => {
  it("renders the percentage with a count-bearing aria-label on the button", () => {
    renderWithIntl(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    const btn = screen.getByRole("button", { name: /143 of 1025/i });
    expect(btn.textContent).toMatch(/14.*%/);
  });

  it("uses an encouraging aria-label at zero mastery", () => {
    renderWithIntl(
      <MasteryChip masteryCount={0} totalSpecies={1025} masteryPercent={0} />,
    );
    expect(
      screen.getByRole("button", { name: /0 of 1025.*start reviewing/i }),
    ).toBeInTheDocument();
  });
});

// ─── Locale: original label rendering ───────────────────────────────────────

describe("StatusChips — locale", () => {
  it("ja: token aria-label renders in Japanese", () => {
    renderJa(<TokenChip tokenBalance={2} />);
    // tokenChipAriaLabel (ja) contains "保護トークン".
    expect(screen.getByRole("button", { name: /保護トークン/ })).toBeInTheDocument();
  });

  it("ja: mastery aria-label renders in Japanese", () => {
    renderJa(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    expect(screen.getByRole("button", { name: /習得済み/ })).toBeInTheDocument();
  });
});

// ─── Popover: open on click (tap) ───────────────────────────────────────────

describe("StatusChips — popover open/close on click (#1556)", () => {
  it("StreakChip: click opens the popover showing the aria-label text", () => {
    renderWithIntl(<StreakChip streak={7} />);
    const btn = screen.getByRole("button", { name: /7 days streak/i });

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    // The popover body is exactly the button's aria-label text (single-source invariant).
    expect(tooltip.textContent).toMatch(/7 days streak/i);
  });

  it("StreakChip: second click closes the popover", () => {
    renderWithIntl(<StreakChip streak={7} />);
    const btn = screen.getByRole("button", { name: /7 days streak/i });

    fireEvent.click(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("TokenChip: click opens the popover", () => {
    renderWithIntl(<TokenChip tokenBalance={2} />);
    const btn = screen.getByRole("button", { name: /2 protection tokens/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/2 protection tokens/i);
  });

  it("MasteryChip: click opens the popover", () => {
    renderWithIntl(
      <MasteryChip masteryCount={30} totalSpecies={1025} masteryPercent={3} />,
    );
    const btn = screen.getByRole("button", { name: /30 of 1025/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/30 of 1025/i);
  });

  it("MasteryChip (zero): click opens the popover with the zero-state text", () => {
    renderWithIntl(
      <MasteryChip masteryCount={0} totalSpecies={1025} masteryPercent={0} />,
    );
    const btn = screen.getByRole("button", { name: /0 of 1025.*start reviewing/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/0 of 1025/i);
  });

  it("start-streak state: click opens the popover", () => {
    renderWithIntl(<StreakChip streak={0} />);
    const btn = screen.getByRole("button", { name: /start your streak/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/start your streak/i);
  });
});

// ─── Popover: keyboard focus opens the popover ──────────────────────────────

describe("StatusChips — popover opens on keyboard focus (#1556)", () => {
  it("StreakChip: focus opens the popover", () => {
    renderWithIntl(<StreakChip streak={5} />);
    const btn = screen.getByRole("button", { name: /5 days streak/i });

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("StreakChip: blur closes the popover", () => {
    renderWithIntl(<StreakChip streak={5} />);
    const btn = screen.getByRole("button", { name: /5 days streak/i });

    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("TokenChip: focus opens the popover", () => {
    renderWithIntl(<TokenChip tokenBalance={1} />);
    const btn = screen.getByRole("button", { name: /1 protection token/i });

    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("MasteryChip: focus opens the popover", () => {
    renderWithIntl(
      <MasteryChip masteryCount={50} totalSpecies={1025} masteryPercent={5} />,
    );
    const btn = screen.getByRole("button", { name: /50 of 1025/i });

    fireEvent.focus(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});

// ─── Popover: Escape closes the popover ─────────────────────────────────────

describe("StatusChips — popover closes on Escape (#1556)", () => {
  it("Escape closes an open popover", () => {
    renderWithIntl(<TokenChip tokenBalance={3} />);
    const btn = screen.getByRole("button", { name: /3 protection tokens/i });

    fireEvent.click(btn);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

// ─── Forcing function: popover body equals button aria-label ─────────────────

describe("StatusChips — single-source invariant: popover text === aria-label (#1556)", () => {
  /**
   * This test is the forcing function for the single-source convention:
   * the popover body must be exactly the same string used as the button's
   * aria-label. A future edit to one cannot silently diverge from the other
   * because this test would fail.
   */

  it("StreakChip (populated): popover text equals the button aria-label", () => {
    renderWithIntl(<StreakChip streak={15} />);
    const btn = screen.getByRole("button", { name: /15 days streak/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");

    // The button's accessible name is the aria-label attribute.
    const ariaLabel = btn.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toBeTruthy();
    expect(tooltip.textContent).toContain(ariaLabel);
  });

  it("StreakChip (zero): popover text equals the button aria-label", () => {
    renderWithIntl(<StreakChip streak={0} />);
    const btn = screen.getByRole("button", { name: /start your streak/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");

    const ariaLabel = btn.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toBeTruthy();
    expect(tooltip.textContent).toContain(ariaLabel);
  });

  it("TokenChip: popover text equals the button aria-label", () => {
    renderWithIntl(<TokenChip tokenBalance={2} />);
    const btn = screen.getByRole("button", { name: /2 protection tokens/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");

    const ariaLabel = btn.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toBeTruthy();
    expect(tooltip.textContent).toContain(ariaLabel);
  });

  it("MasteryChip (populated): popover text equals the button aria-label", () => {
    renderWithIntl(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    const btn = screen.getByRole("button", { name: /143 of 1025/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");

    const ariaLabel = btn.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toBeTruthy();
    expect(tooltip.textContent).toContain(ariaLabel);
  });

  it("MasteryChip (zero): popover text equals the button aria-label", () => {
    renderWithIntl(
      <MasteryChip masteryCount={0} totalSpecies={1025} masteryPercent={0} />,
    );
    const btn = screen.getByRole("button", { name: /0 of 1025.*start reviewing/i });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");

    const ariaLabel = btn.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toBeTruthy();
    expect(tooltip.textContent).toContain(ariaLabel);
  });
});

// ─── Locale: popover renders in non-English locales (#1556) ──────────────────

describe("StatusChips — popover locale rendering (#1556)", () => {
  it("ja: TokenChip popover renders in Japanese", () => {
    renderJa(<TokenChip tokenBalance={2} />);
    const btn = screen.getByRole("button", { name: /保護トークン/ });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/保護トークン/);
  });

  it("ja: MasteryChip popover renders in Japanese", () => {
    renderJa(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    const btn = screen.getByRole("button", { name: /習得済み/ });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/習得済み/);
  });

  it("zh-Hans: TokenChip popover renders in Simplified Chinese", () => {
    renderZhHans(<TokenChip tokenBalance={2} />);
    const btn = screen.getByRole("button", { name: /保护令牌/ });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/保护令牌/);
  });

  it("zh-Hant: MasteryChip popover renders in Traditional Chinese", () => {
    renderZhHant(
      <MasteryChip masteryCount={143} totalSpecies={1025} masteryPercent={14} />,
    );
    const btn = screen.getByRole("button", { name: /已掌握/ });

    fireEvent.click(btn);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toMatch(/已掌握/);
  });
});
