/**
 * FilterChip component tests.
 *
 * State coverage: active (aria-pressed=true) AND inactive (aria-pressed=false),
 * default colour variant AND custom activeClassName, disabled state.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterChip } from "@/components/ui/FilterChip";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noop() {
  // no-op
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FilterChip", () => {
  it("renders as a button with the provided children", () => {
    render(
      <FilterChip active={false} onClick={noop}>
        Fire
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "Fire" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // State coverage: inactive
  // -------------------------------------------------------------------------

  it("sets aria-pressed=false when inactive", () => {
    render(
      <FilterChip active={false} onClick={noop}>
        Water
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("applies inactive zinc classes when active=false", () => {
    render(
      <FilterChip active={false} onClick={noop}>
        Grass
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Grass" });
    expect(btn.className).toContain("bg-zinc-100");
    expect(btn.className).toContain("text-zinc-700");
  });

  // -------------------------------------------------------------------------
  // State coverage: active
  // -------------------------------------------------------------------------

  it("sets aria-pressed=true when active", () => {
    render(
      <FilterChip active={true} onClick={noop}>
        Fire
      </FilterChip>,
    );
    expect(screen.getByRole("button", { name: "Fire" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("applies default active classes (dark zinc) when active=true and no activeClassName", () => {
    render(
      <FilterChip active={true} onClick={noop}>
        Ice
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Ice" });
    expect(btn.className).toContain("bg-zinc-800");
    expect(btn.className).toContain("text-white");
  });

  it("applies custom activeClassName instead of default zinc when active=true", () => {
    render(
      <FilterChip active={true} onClick={noop} activeClassName="bg-red-500 text-white">
        Fire
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Fire" });
    expect(btn.className).toContain("bg-red-500");
    expect(btn.className).not.toContain("bg-zinc-800");
  });

  it("does not apply activeClassName when active=false", () => {
    render(
      <FilterChip active={false} onClick={noop} activeClassName="bg-red-500 text-white">
        Fire
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Fire" });
    expect(btn.className).not.toContain("bg-red-500");
    expect(btn.className).toContain("bg-zinc-100");
  });

  // -------------------------------------------------------------------------
  // Focus ring
  // -------------------------------------------------------------------------

  it("includes theme-accent focus-visible ring classes", () => {
    render(
      <FilterChip active={false} onClick={noop}>
        Normal
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Normal" });
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:ring-[var(--theme-accent)]");
  });

  // -------------------------------------------------------------------------
  // Click handler
  // -------------------------------------------------------------------------

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(
      <FilterChip active={false} onClick={handleClick}>
        Dragon
      </FilterChip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Dragon" }));
    expect(handleClick).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // ariaLabel override
  // -------------------------------------------------------------------------

  it("uses ariaLabel prop as accessible name when provided", () => {
    render(
      <FilterChip active={false} onClick={noop} ariaLabel="Filter by Fire type">
        Fire
      </FilterChip>,
    );
    expect(
      screen.getByRole("button", { name: "Filter by Fire type" }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  it("is disabled and not clickable when disabled=true", async () => {
    const handleClick = vi.fn();
    render(
      <FilterChip active={false} onClick={handleClick} disabled={true}>
        Ghost
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Ghost" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Padding variants
  // -------------------------------------------------------------------------

  it("uses px-3 py-0.5 by default", () => {
    render(
      <FilterChip active={false} onClick={noop}>
        Fairy
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Fairy" });
    expect(btn.className).toContain("px-3");
    expect(btn.className).toContain("py-0.5");
  });

  it("uses the provided padding prop", () => {
    render(
      <FilterChip active={false} onClick={noop} padding="px-2.5 py-0.5">
        Electric
      </FilterChip>,
    );
    const btn = screen.getByRole("button", { name: "Electric" });
    expect(btn.className).toContain("px-2.5");
    expect(btn.className).not.toContain("px-3");
  });
});
