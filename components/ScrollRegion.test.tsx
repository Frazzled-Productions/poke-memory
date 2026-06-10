/**
 * Component tests for ScrollRegion (#1801 / #1839 scroll regression fix).
 *
 * Covers:
 *   - On the Practice route (`/`) the region has `overflow-hidden` (fit container).
 *   - On any other route (e.g. `/settings`) the region has `overflow-y-auto`.
 *   - The `data-scroll-region` attribute is always present.
 *   - Children are rendered in both states.
 *   - `min-h-0` and `flex-1` are present in both states (height-chain integrity).
 *   - `md:overflow-visible` is always present (desktop revert).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { ScrollRegion } from "@/components/ScrollRegion";

describe("ScrollRegion", () => {
  it("renders children", () => {
    mockPathname.value = "/settings";
    render(
      <ScrollRegion>
        <span data-testid="child">content</span>
      </ScrollRegion>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("always sets data-scroll-region attribute", () => {
    mockPathname.value = "/";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    expect(container.querySelector("[data-scroll-region]")).not.toBeNull();
  });

  it("uses overflow-hidden on the Practice route (`/`)", () => {
    mockPathname.value = "/";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("overflow-hidden");
    expect(el.className).not.toContain("overflow-y-auto");
  });

  it("uses overflow-y-auto on non-Practice routes (e.g. /settings)", () => {
    mockPathname.value = "/settings";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("overflow-y-auto");
    expect(el.className).not.toContain("overflow-hidden");
  });

  it("uses overflow-y-auto on /privacy", () => {
    mockPathname.value = "/privacy";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("overflow-y-auto");
  });

  it("uses overflow-y-auto on /terms", () => {
    mockPathname.value = "/terms";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("overflow-y-auto");
  });

  it("preserves the height-chain flex classes (flex-1, flex-col, min-h-0) on Practice", () => {
    mockPathname.value = "/";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("flex-1");
    expect(el.className).toContain("flex-col");
    expect(el.className).toContain("min-h-0");
  });

  it("preserves the height-chain flex classes (flex-1, flex-col, min-h-0) on /settings", () => {
    mockPathname.value = "/settings";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("flex-1");
    expect(el.className).toContain("flex-col");
    expect(el.className).toContain("min-h-0");
  });

  it("always includes md:overflow-visible for the desktop revert", () => {
    mockPathname.value = "/settings";
    const { container } = render(<ScrollRegion>x</ScrollRegion>);
    const el = container.querySelector("[data-scroll-region]") as HTMLElement;
    expect(el.className).toContain("md:overflow-visible");
  });
});
