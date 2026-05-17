/**
 * Component tests for NavDrawer — the mobile hamburger / drawer disclosure.
 *
 * Covers:
 * - Hamburger button aria-expanded starts as false
 * - Clicking the hamburger opens the drawer (aria-expanded true, dialog visible)
 * - Esc key closes the drawer and returns focus to the trigger
 * - Clicking the close button inside the drawer closes it
 * - aria-current="page" is set on the active link
 * - Pasture link appears when pretendAllMastered flag is on (hasMastered = false)
 */

import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// usePathname from next/navigation
const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));

// next/link — render as a plain anchor in jsdom
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
    // next/link's aria-current is typed narrowly; widen to string for the mock.
    "aria-current"?: React.AriaAttributes["aria-current"];
    "aria-label"?: string;
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

// lib dependencies used by NavDrawer
vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ masteryRepetitions: 3 })),
}));

vi.mock("@/lib/review/useSessionStorageKey", () => ({
  useSessionStorageKey: vi.fn().mockReturnValue(0),
}));

// useSuperuser is mocked via a vi.fn() so individual tests can override it.
const mockUseSuperuser = vi.fn(() => ({ flags: { pretendAllMastered: false } }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

vi.mock("@/components/whats-new/WhatsNewIndicator", () => ({
  WhatsNewIndicator: () => null,
}));

vi.mock("@/components/auth/AuthButton", () => ({
  AuthButton: () => null,
}));

// ---------------------------------------------------------------------------

import { NavDrawer } from "@/components/NavDrawer";

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPathname.value = "/";
  mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
});

describe("NavDrawer", () => {
  it("renders the hamburger button with aria-expanded=false initially", () => {
    render(<NavDrawer />);

    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the drawer when the hamburger button is clicked", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    const trigger = screen.getByRole("button", { name: "Open navigation menu" });

    // Drawer starts with aria-hidden="true" (always in DOM, off-screen)
    const drawer = document.getElementById("mobile-nav-drawer");
    expect(drawer).toHaveAttribute("aria-hidden", "true");

    await user.click(trigger);

    // aria-expanded flips to true; the trigger's label changes to "Close"
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-label", "Close navigation menu");

    // Drawer becomes visible (aria-hidden set to false)
    expect(drawer).toHaveAttribute("aria-hidden", "false");

    // Primary nav links are accessible
    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes the drawer when the close button inside the drawer is clicked", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    // The close button inside the drawer header (scoped to avoid matching the
    // hamburger trigger which also bears "Close navigation menu" when open)
    const drawerEl = document.getElementById("mobile-nav-drawer")!;
    const closeBtn = within(drawerEl).getByRole("button", { name: "Close navigation menu" });
    await user.click(closeBtn);

    const drawer = document.getElementById("mobile-nav-drawer");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    // Trigger label goes back to "Open"
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the drawer when Esc is pressed", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    const drawer = document.getElementById("mobile-nav-drawer");
    expect(drawer).toHaveAttribute("aria-hidden", "false");

    await user.keyboard("{Escape}");

    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it("restores focus to the hamburger trigger after closing with Esc", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    await user.keyboard("{Escape}");

    // Focus should be back on the trigger
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Open navigation menu" }),
      );
    });
  });

  it("marks the current page link with aria-current='page'", async () => {
    mockPathname.value = "/stats";
    const user = userEvent.setup();

    render(<NavDrawer />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    const statsLink = screen.getByRole("link", { name: "Stats" });
    expect(statsLink).toHaveAttribute("aria-current", "page");

    const practiceLink = screen.getByRole("link", { name: "Practice" });
    expect(practiceLink).not.toHaveAttribute("aria-current");
  });

  it("shows the Pasture link when pretendAllMastered flag is on (hasMastered false)", async () => {
    // hasMastered stays false (loadSession returns null, filterMastered returns []).
    // The Pasture link should appear solely because pretendAllMastered is true.
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });

    const user = userEvent.setup();
    render(<NavDrawer />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });
});
