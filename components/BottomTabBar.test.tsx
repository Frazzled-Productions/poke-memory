/**
 * Component tests for BottomTabBar (issue #852, #1369 i18n wiring, #1516 hook
 * extraction).
 *
 * Covers:
 *   - Static tab list includes the Journey entry.
 *   - Active tab carries aria-current="page".
 *   - Pasture tab appears when usePastureMasteryState returns showPasture=true.
 *   - Pasture tab hidden when showPasture=false (default).
 *   - The bar is hidden in hamburger mode.
 *   - Japanese locale renders the correct translated label (練習 for Practice).
 *   - BottomTabBarFallback renders translated tab labels (en + ja).
 *
 * Mastery derivation logic (SETTINGS_SAVED_EVENT, KEY_HAS_MASTERED fast path,
 * epoch catch-up) is tested in
 * components/usePastureMasteryState.test.tsx (#1516).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-current": ariaCurrent,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
    "aria-label"?: string;
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

const mockUsePastureMasteryState = vi.fn(() => ({ showPasture: false }));
vi.mock("@/lib/pasture/usePastureMasteryState", () => ({
  usePastureMasteryState: () => mockUsePastureMasteryState(),
}));

import type { MobileNav } from "@/lib/settings/persistence";

const mockLoadSettings = vi.fn(
  (): { mobileNav: MobileNav } => ({
    mobileNav: "bottom",
  }),
);
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// Mock useStreakNavState so the Stats tab aria-label stays plain in these
// tests (streak data defaulting to null = no aria-label override applied).
vi.mock("@/lib/streak/useStreakNavState", () => ({
  useStreakNavState: () => ({ streak: null, tokenBalance: null, daysToNextMilestone: null }),
}));

// ---------------------------------------------------------------------------

import { BottomTabBar, BottomTabBarFallback } from "@/components/BottomTabBar";

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPathname.value = "/";
  mockUsePastureMasteryState.mockReturnValue({ showPasture: false });
  mockLoadSettings.mockReturnValue({ mobileNav: "bottom" });
});

describe("BottomTabBar", () => {
  it("renders the Journey tab link", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    });
  });

  it("includes all core tabs: Practice, Stats, Journey, Pokédex, Settings", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    });
  });

  it("marks the active tab with aria-current='page'", async () => {
    mockPathname.value = "/journey";

    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      const journeyLink = screen.getByRole("link", { name: "Journey" });
      expect(journeyLink).toHaveAttribute("aria-current", "page");
    });

    const practiceLink = screen.getByRole("link", { name: "Practice" });
    expect(practiceLink).not.toHaveAttribute("aria-current");
  });

  it("marks /stats as current when pathname is /stats", async () => {
    mockPathname.value = "/stats";

    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Stats" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });

  it("hides Pasture tab when hasMastered=false and pretendAllMastered=false", async () => {
    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();
  });

  it("shows Pasture tab when usePastureMasteryState returns showPasture=true", async () => {
    mockUsePastureMasteryState.mockReturnValue({ showPasture: true });

    renderWithIntl(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });

  it("renders nothing when mobileNav is 'hamburger'", async () => {
    mockLoadSettings.mockReturnValue({
      mobileNav: "hamburger" as MobileNav,
    });

    const { container } = renderWithIntl(<BottomTabBar />);

    // Allow time for the effect to read the setting
    await waitFor(() => {
      // The specific nav landmark should not exist (mobileNav is hamburger so inner renders null)
      expect(container.querySelector('[aria-label="Mobile tab navigation"]')).toBeNull();
    });
  });
});

describe("BottomTabBar — Japanese locale", () => {
  it("renders the Practice tab label in Japanese (練習)", async () => {
    renderJa(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "練習" })).toBeInTheDocument();
    });
  });
});

describe("BottomTabBarFallback", () => {
  it("renders translated tab labels for all static tabs (English)", async () => {
    renderWithIntl(<BottomTabBarFallback />);

    // The fallback renders all STATIC_TAB_DEFS labels via t(key).
    // It is aria-hidden so we query by text content directly.
    await waitFor(() => {
      expect(screen.getByText("Practice")).toBeInTheDocument();
      expect(screen.getByText("Stats")).toBeInTheDocument();
      expect(screen.getByText("Journey")).toBeInTheDocument();
      expect(screen.getByText("Pokédex")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  it("renders translated tab labels in Japanese locale (練習, 図鑑)", async () => {
    renderJa(<BottomTabBarFallback />);

    await waitFor(() => {
      expect(screen.getByText("練習")).toBeInTheDocument();
      expect(screen.getByText("図鑑")).toBeInTheDocument();
    });
  });
});
