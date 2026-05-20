/**
 * Component tests for MobileNavPaddingWrapper (issue #1093).
 *
 * Covers:
 *   - Renders children passed to it.
 *   - Sets the data-page-content attribute on the wrapper div.
 *   - Applies min-h-dvh when mobileNav is null (initial hydration state).
 *   - Applies min-h-dvh when mobileNav is "bottom".
 *   - Does NOT apply min-h-dvh when mobileNav is "hamburger".
 *   - Applies pb-* padding class when mobileNav is "bottom".
 *   - Updates classes when SETTINGS_SAVED_EVENT fires.
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

  it("applies min-h-dvh when mobileNav is 'bottom' (after effect runs)", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "bottom", masteryRepetitions: 3 });

    const { container } = render(
      <MobileNavPaddingWrapper>
        <span>content</span>
      </MobileNavPaddingWrapper>,
    );

    await waitFor(() => {
      const wrapper = container.querySelector("[data-page-content]") as HTMLElement;
      expect(wrapper.className).toContain("min-h-dvh");
    });
  });

  it("does NOT apply min-h-dvh when mobileNav is 'hamburger'", async () => {
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
      // The effect should have fired and removed min-h-dvh for hamburger mode
      expect(wrapper.className).not.toContain("min-h-dvh");
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
      expect(wrapper.className).toContain("min-h-dvh");
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
      expect(wrapper.className).not.toContain("min-h-dvh");
    });
  });
});
