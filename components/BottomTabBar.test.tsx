/**
 * Component tests for BottomTabBar (issue #852).
 *
 * Covers:
 *   - Static tab list includes the Journey entry.
 *   - Active tab carries aria-current="page".
 *   - Pasture tab appears when pretendAllMastered flag is on.
 *   - Pasture tab hidden when hasMastered=false and flag is off.
 *   - The bar is hidden in hamburger mode.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/review/useSessionStorageKey", () => ({
  useSessionStorageKey: vi.fn().mockReturnValue(0),
}));

const mockUseSuperuser = vi.fn(() => ({ flags: { pretendAllMastered: false } }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

import type { MobileNav } from "@/lib/settings/persistence";

const mockLoadSettings = vi.fn((): { mobileNav: MobileNav } => ({
  mobileNav: "bottom",
}));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

// ---------------------------------------------------------------------------

import { BottomTabBar } from "@/components/BottomTabBar";

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPathname.value = "/";
  mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
  mockLoadSettings.mockReturnValue({ mobileNav: "bottom" });
});

describe("BottomTabBar", () => {
  it("renders the Journey tab link", async () => {
    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    });
  });

  it("includes all core tabs: Practice, Stats, Journey, Pokédex, Settings", async () => {
    render(<BottomTabBar />);

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

    render(<BottomTabBar />);

    await waitFor(() => {
      const journeyLink = screen.getByRole("link", { name: "Journey" });
      expect(journeyLink).toHaveAttribute("aria-current", "page");
    });

    const practiceLink = screen.getByRole("link", { name: "Practice" });
    expect(practiceLink).not.toHaveAttribute("aria-current");
  });

  it("marks /stats as current when pathname is /stats", async () => {
    mockPathname.value = "/stats";

    render(<BottomTabBar />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Stats" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });

  it("hides Pasture tab when hasMastered=false and pretendAllMastered=false", async () => {
    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();
  });

  it("shows Pasture tab when pretendAllMastered flag is on", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });

    render(<BottomTabBar />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });

  it("renders nothing when mobileNav is 'hamburger'", async () => {
    mockLoadSettings.mockReturnValue({ mobileNav: "hamburger" as MobileNav });

    const { container } = render(<BottomTabBar />);

    // Allow time for the effect to read the setting
    await waitFor(() => {
      // The nav landmark should not exist
      expect(
        container.querySelector('[aria-label="Mobile tab navigation"]'),
      ).toBeNull();
    });
  });
});
