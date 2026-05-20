/**
 * Unit tests for DueForecast.
 *
 * Covers the tooltip toggle / hover / keyboard logic extracted for #1082.
 * Lines that drive the diff-coverage gate: bar click, dismiss, outside-click,
 * Escape key, Enter/Space key, mouseenter/mouseleave hover path, and the
 * hoverOpenedIdx guard that prevents a synthetic mouseenter from immediately
 * closing a tooltip opened by a real click.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import DueForecast from "@/components/stats/DueForecast";
import type { DueForecastDay } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build 14 forecast days starting from a fixed date. */
function makeForecast(countOverride?: Partial<Record<number, number>>): readonly DueForecastDay[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date("2026-05-20");
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    return { date: iso, count: countOverride?.[i] ?? i * 2 };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBar(idx: number) {
  const list = screen.getByRole("list", { name: /14-day due forecast/i });
  const items = list.querySelectorAll('[role="listitem"]');
  const item = items[idx];
  if (!item) throw new Error(`No listitem at index ${idx}`);
  const btn = item.querySelector("button");
  if (!btn) throw new Error(`No button inside listitem ${idx}`);
  return btn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DueForecast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 14 bars", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const list = screen.getByRole("list", { name: /14-day due forecast/i });
    const items = list.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(14);
  });

  it("shows correct total card count", () => {
    // counts 0,2,4,...26 → sum = 182
    render(<DueForecast forecast={makeForecast()} />);
    expect(screen.getByText(/182 cards over the next 14 days/i)).toBeInTheDocument();
  });

  it("shows '1 card' (singular) when total is 1", () => {
    const forecast = makeForecast({ 0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0 });
    render(<DueForecast forecast={forecast} />);
    expect(screen.getByText(/1 card over the next 14 days/i)).toBeInTheDocument();
  });

  it("shows no tooltip on initial render", () => {
    render(<DueForecast forecast={makeForecast()} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("clicking a bar opens the tooltip with date and count", () => {
    const forecast = makeForecast({ 3: 5 });
    render(<DueForecast forecast={forecast} fmt="dmy" tz="UTC" />);
    const bar = getBar(3);
    fireEvent.click(bar);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    // Should contain the count
    expect(tooltip.textContent).toMatch(/5 cards/);
  });

  it("clicking the same bar again dismisses the tooltip", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(2);
    fireEvent.click(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(bar);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("clicking a different bar moves the tooltip to the new bar", () => {
    const forecast = makeForecast({ 1: 3, 2: 7 });
    render(<DueForecast forecast={forecast} fmt="dmy" tz="UTC" />);

    fireEvent.click(getBar(1));
    expect(screen.getByRole("tooltip").textContent).toMatch(/3 cards/);

    fireEvent.click(getBar(2));
    expect(screen.getByRole("tooltip").textContent).toMatch(/7 cards/);
  });

  it("clicking outside the container dismisses the tooltip", async () => {
    render(
      <div>
        <DueForecast forecast={makeForecast()} />
        <button data-testid="outside">Outside</button>
      </div>,
    );
    fireEvent.click(getBar(1));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it("Escape key dismisses the tooltip", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(1);
    fireEvent.click(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(bar, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("Enter key opens the tooltip on a focused bar", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(4);
    fireEvent.keyDown(bar, { key: "Enter" });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("Space key opens the tooltip on a focused bar", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(5);
    fireEvent.keyDown(bar, { key: " " });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("mouseenter opens the tooltip", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(3);
    fireEvent.mouseEnter(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("mouseleave closes the tooltip when it was opened by hover", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(3);
    fireEvent.mouseEnter(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(bar);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("mouseleave does NOT close the tooltip when it was opened by click", () => {
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(3);
    // Open via click (lastInteraction = "click")
    fireEvent.click(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    // Simulate mouse leaving the bar — should NOT dismiss
    fireEvent.mouseLeave(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hoverOpenedIdx guard: mouseenter then click on the same bar does not close the tooltip", () => {
    // On mobile WebKit, a tap fires synthetic mouseenter before onClick.
    // The guard in handleBarClick detects this and skips the toggle.
    render(<DueForecast forecast={makeForecast()} />);
    const bar = getBar(6);
    // Simulate the WebKit synthetic-event sequence: mouseenter fires first
    fireEvent.mouseEnter(bar);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    // Then click fires — without the guard, this would close the tooltip
    fireEvent.click(bar);
    // Tooltip should remain open
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("bars at index 0-2 use left-anchored tooltip position class", () => {
    const forecast = makeForecast({ 0: 10 });
    render(<DueForecast forecast={forecast} />);
    fireEvent.click(getBar(0));
    const tooltip = screen.getByRole("tooltip");
    // The left-anchor class applied by tooltipPositionClasses(0)
    expect(tooltip.className).toContain("left-0");
    expect(tooltip.className).not.toContain("right-0");
  });

  it("bars at index 11-13 use right-anchored tooltip position class", () => {
    const forecast = makeForecast({ 13: 8 });
    render(<DueForecast forecast={forecast} />);
    fireEvent.click(getBar(13));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("right-0");
    expect(tooltip.className).toContain("left-auto");
  });

  it("bars at index 3-10 use centred tooltip position class", () => {
    const forecast = makeForecast({ 5: 6 });
    render(<DueForecast forecast={forecast} />);
    fireEvent.click(getBar(5));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("left-1/2");
    expect(tooltip.className).toContain("-translate-x-1/2");
  });

  it("the first date label reads 'Today'", () => {
    render(<DueForecast forecast={makeForecast()} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("shows the due-forecast section heading", () => {
    render(<DueForecast forecast={makeForecast()} />);
    expect(
      screen.getByRole("heading", { name: /due forecast/i }),
    ).toBeInTheDocument();
  });
});
