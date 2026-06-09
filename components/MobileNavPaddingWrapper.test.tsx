/**
 * Component tests for MobileNavPaddingWrapper.
 *
 * As of #1801 the component is a stateless flex-1 height-chain link only.
 * The BottomTabBar is now in-flow (not fixed), so no bottom padding is needed.
 * Covers:
 *   - Renders children.
 *   - Sets the data-page-content attribute.
 *   - Applies the height-chain flex classes (flex, flex-1, flex-col, min-h-0).
 *   - Never applies the old fixed-bar-clearing pb-* padding (#1801).
 *   - Never applies min-h-dvh or min-h-[100svh] (#1087 regression guard).
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { MobileNavPaddingWrapper } from "@/components/MobileNavPaddingWrapper";

describe("MobileNavPaddingWrapper", () => {
  it("renders children passed to it", () => {
    render(
      <MobileNavPaddingWrapper>
        <span data-testid="child">Hello</span>
      </MobileNavPaddingWrapper>,
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toHaveTextContent("Hello");
  });

  it("sets the data-page-content attribute on the wrapper div", () => {
    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    expect(container.querySelector("[data-page-content]")).not.toBeNull();
  });

  it("applies the flex-1 height-chain classes", () => {
    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("flex-col");
    expect(wrapper.className).toContain("min-h-0");
  });

  it("never applies the old fixed-bar-clearing bottom padding (#1801)", () => {
    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
    // The bar is now in-flow; no bottom padding is required to clear it.
    expect(wrapper.className).not.toContain("pb-[calc(4rem+env(safe-area-inset-bottom))]");
  });

  it("never applies min-h-dvh or min-h-[100svh] on the wrapper itself (#1087)", () => {
    // min-h-[100svh] belongs on <body> (the #1728 cold-paint anchor), not here.
    // Putting it on the wrapper forced Practice to scroll again (#1087).
    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
    expect(wrapper.className).not.toContain("min-h-dvh");
    expect(wrapper.className).not.toContain("min-h-[100svh]");
  });
});
