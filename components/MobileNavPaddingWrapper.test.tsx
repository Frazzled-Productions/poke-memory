/**
 * Component tests for MobileNavPaddingWrapper (issue #1093).
 *
 * Covers:
 *   - Renders children passed to it.
 *   - Sets the data-page-content attribute on the wrapper div.
 *   - Applies pb-* padding class when mobileNav is "bottom".
 *   - Updates classes when SETTINGS_SAVED_EVENT fires.
 *
 * The page-height guarantee that anchors the iOS Safari bottom tab bar
 * (#1086) now lives on <body> in app/layout.tsx (`min-h-[100svh]`), not on
 * this wrapper. Putting it here forced the wrapper to 100svh on top of the Nav
 * and any sibling banners, pushing the Practice page past the viewport
 * (#1087 regression). The wrapper now only owns the bottom-tab-bar padding.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

import type { MobileNav } from "@/lib/settings/persistence";

const mockLoadSettings = vi.fn(
  (): { mobileNav: MobileNav; masteryRepetitions: number } => ({
    mobileNav: "bottom",
    masteryRepetitions: 3,
  }),
);

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// ---------------------------------------------------------------------------

import { MobileNavPaddingWrapper } from "@/components/MobileNavPaddingWrapper";

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });
});

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

  it("never applies min-h-dvh or min-h-[100svh] on the wrapper itself (#1087)", async () => {
    // min-h-[100svh] now lives on <body> so the wrapper can be a true flex-1
    // child and shrink to fit alongside the Nav and any sibling banners. If
    // this assertion regresses, the Practice page will require scrolling again
    // on iPhone 17 Pro because the wrapper will push past the viewport.
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });

    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    await waitFor(() => {
      const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
      // Effect has run; pb-* is the marker that "bottom" mode took effect.
      expect(wrapper.className).toContain("pb-[calc(4rem+env(safe-area-inset-bottom))]");
      // The body's min-height anchor must never migrate to this wrapper.
      expect(wrapper.className).not.toContain("min-h-dvh");
      expect(wrapper.className).not.toContain("min-h-[100svh]");
    });
  });

  it("applies the bottom padding class when mobileNav is 'bottom'", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });

    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    await waitFor(() => {
      const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
      expect(wrapper.className).toContain("pb-[calc(4rem+env(safe-area-inset-bottom))]");
    });
  });

  it("does NOT apply the bottom padding class when mobileNav is 'hamburger'", async () => {
    mockLoadSettings.mockReturnValue({
      mobileNav: "hamburger" as MobileNav,
      masteryRepetitions: 3,
    });

    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    await waitFor(() => {
      const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
      expect(wrapper.className).not.toContain(
        "pb-[calc(4rem+env(safe-area-inset-bottom))]",
      );
    });
  });

  it("updates classes when SETTINGS_SAVED_EVENT fires", async () => {
    // Start in bottom mode
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });

    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    await waitFor(() => {
      const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
      expect(wrapper.className).toContain("pb-[calc(4rem+env(safe-area-inset-bottom))]");
    });

    // User switches to hamburger mode in Settings; SETTINGS_SAVED_EVENT fires
    mockLoadSettings.mockReturnValue({
      mobileNav: "hamburger" as MobileNav,
      masteryRepetitions: 3,
    });

    act(() => {
      window.dispatchEvent(new Event("poke-memory:settings-saved"));
    });

    await waitFor(() => {
      const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
      expect(wrapper.className).not.toContain("pb-[calc(4rem+env(safe-area-inset-bottom))]");
    });
  });
});
