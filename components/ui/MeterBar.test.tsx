/**
 * MeterBar component tests.
 *
 * State coverage: value=0 (empty), value=max (full), mid value, and the
 * accessible attributes (role=meter, aria-valuenow, aria-valuemin, aria-valuemax,
 * aria-label).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeterBar } from "@/components/ui/MeterBar";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MeterBar", () => {
  // -------------------------------------------------------------------------
  // Accessible role and ARIA attributes
  // -------------------------------------------------------------------------

  it("renders with role=meter", () => {
    render(
      <MeterBar value={50} max={100} fillClass="bg-emerald-500" label="Progress: 50 of 100" />,
    );
    expect(screen.getByRole("meter")).toBeInTheDocument();
  });

  it("sets aria-valuenow to the current value", () => {
    render(
      <MeterBar value={42} max={100} fillClass="bg-emerald-500" label="Mastered: 42 of 100" />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "42");
  });

  it("sets aria-valuemin to 0", () => {
    render(
      <MeterBar value={10} max={100} fillClass="bg-emerald-500" label="Test" />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuemin", "0");
  });

  it("sets aria-valuemax to max", () => {
    render(
      <MeterBar value={10} max={200} fillClass="bg-emerald-500" label="Test" />,
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuemax", "200");
  });

  it("sets aria-label from the label prop", () => {
    render(
      <MeterBar value={5} max={10} fillClass="bg-blue-500" label="Introduced: 5 of 10" />,
    );
    expect(screen.getByRole("meter", { name: "Introduced: 5 of 10" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // State coverage: empty (value=0)
  // -------------------------------------------------------------------------

  it("renders an empty fill (0% width) when value=0", () => {
    render(
      <MeterBar value={0} max={100} fillClass="bg-emerald-500" label="Nothing mastered" />,
    );
    const meter = screen.getByRole("meter");
    // The fill div is the first child.
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("renders an empty fill when max=0 (avoids division by zero)", () => {
    render(
      <MeterBar value={0} max={0} fillClass="bg-emerald-500" label="Empty state" />,
    );
    const meter = screen.getByRole("meter");
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  // -------------------------------------------------------------------------
  // State coverage: full (value=max)
  // -------------------------------------------------------------------------

  it("renders a 100% fill when value equals max", () => {
    render(
      <MeterBar value={100} max={100} fillClass="bg-emerald-500" label="Fully mastered" />,
    );
    const meter = screen.getByRole("meter");
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  // -------------------------------------------------------------------------
  // State coverage: mid value
  // -------------------------------------------------------------------------

  it("renders a proportional fill for a mid value", () => {
    render(
      <MeterBar value={25} max={100} fillClass="bg-emerald-500" label="25% mastered" />,
    );
    const meter = screen.getByRole("meter");
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("rounds the fill percentage to the nearest integer", () => {
    // 1 of 3 = 33.333...% → rounds to 33%.
    render(
      <MeterBar value={1} max={3} fillClass="bg-emerald-500" label="1 of 3" />,
    );
    const meter = screen.getByRole("meter");
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("33%");
  });

  // -------------------------------------------------------------------------
  // fillClass
  // -------------------------------------------------------------------------

  it("applies the fillClass to the fill element", () => {
    render(
      <MeterBar value={50} max={100} fillClass="bg-amber-400 dark:bg-amber-500" label="Test" />,
    );
    const meter = screen.getByRole("meter");
    const fill = meter.firstElementChild as HTMLElement;
    expect(fill.className).toContain("bg-amber-400");
  });

  // -------------------------------------------------------------------------
  // trackClass / className
  // -------------------------------------------------------------------------

  it("applies the default dark:bg-zinc-700 track class when trackClass is not provided", () => {
    render(
      <MeterBar value={10} max={100} fillClass="bg-emerald-500" label="Test" />,
    );
    expect(screen.getByRole("meter").className).toContain("dark:bg-zinc-700");
  });

  it("uses a custom trackClass when provided", () => {
    render(
      <MeterBar
        value={10}
        max={100}
        fillClass="bg-emerald-500"
        label="Test"
        trackClass="dark:bg-zinc-800"
      />,
    );
    const meter = screen.getByRole("meter");
    expect(meter.className).toContain("dark:bg-zinc-800");
    expect(meter.className).not.toContain("dark:bg-zinc-700");
  });

  it("applies the className prop to the track container", () => {
    render(
      <MeterBar
        value={10}
        max={100}
        fillClass="bg-emerald-500"
        label="Test"
        className="w-20"
      />,
    );
    expect(screen.getByRole("meter").className).toContain("w-20");
  });

  // -------------------------------------------------------------------------
  // transitionClass - animation fidelity
  // -------------------------------------------------------------------------

  it("applies the default transition-all class to the fill div when transitionClass is omitted", () => {
    render(
      <MeterBar value={50} max={100} fillClass="bg-emerald-500" label="Test" />,
    );
    const fill = screen.getByRole("meter").firstElementChild as HTMLElement;
    expect(fill.className).toContain("transition-all");
  });

  it("applies a custom transitionClass to the fill div", () => {
    render(
      <MeterBar
        value={50}
        max={100}
        fillClass="bg-emerald-500"
        label="Test"
        transitionClass="transition-all duration-300"
      />,
    );
    const fill = screen.getByRole("meter").firstElementChild as HTMLElement;
    expect(fill.className).toContain("transition-all");
    expect(fill.className).toContain("duration-300");
  });

  it("suppresses all transition when transitionClass is empty string", () => {
    render(
      <MeterBar
        value={50}
        max={100}
        fillClass="bg-emerald-500"
        label="Test"
        transitionClass=""
      />,
    );
    const fill = screen.getByRole("meter").firstElementChild as HTMLElement;
    expect(fill.className).not.toContain("transition");
  });
});
