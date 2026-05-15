/**
 * Component tests for NavDrawer — the mobile hamburger / drawer disclosure.
 *
 * Covers:
 * - Hamburger button aria-expanded starts as false
 * - Clicking the hamburger opens the drawer (aria-expanded true, dialog visible)
 * - Esc key closes the drawer and returns focus to the trigger
 * - Clicking the close button inside the drawer closes it
 * - aria-current="page" is set on the active link
 */

import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/lib/review/useSessionStorageKey", () => ({
  useSessionStorageKey: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false } }),
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

    // Drawer starts hidden
    const drawer = document.getElementById("mobile-nav-drawer");
    expect(drawer).toHaveAttribute("hidden");

    await user.click(trigger);

    // aria-expanded flips to true
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Drawer becomes visible
    expect(drawer).not.toHaveAttribute("hidden");

    // Primary nav links are accessible
    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes the drawer when the close button inside the drawer is clicked", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    await user.click(trigger);

    const closeBtn = screen.getByRole("button", { name: "Close navigation menu" });
    await user.click(closeBtn);

    const drawer = document.getElementById("mobile-nav-drawer");
    expect(drawer).toHaveAttribute("hidden");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the drawer when Esc is pressed", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    await user.click(trigger);

    const drawer = document.getElementById("mobile-nav-drawer");
    expect(drawer).not.toHaveAttribute("hidden");

    await user.keyboard("{Escape}");

    expect(drawer).toHaveAttribute("hidden");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("restores focus to the hamburger trigger after closing with Esc", async () => {
    const user = userEvent.setup();
    render(<NavDrawer />);

    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    // Focus should be back on the trigger
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
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

  it("shows the Pasture link when pretendAllMastered flag is on", async () => {
    // Re-mock with flag on
    vi.doMock("@/lib/superuser/SuperuserContext", () => ({
      useSuperuser: () => ({ flags: { pretendAllMastered: true } }),
    }));

    // We test this path via hasMastered state — simulate mastered cards
    const { filterMastered } = await import("@/lib/pasture/arrivals");
    (filterMastered as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 1 }]);
    const { loadSession } = await import("@/lib/review/persistence");
    (loadSession as ReturnType<typeof vi.fn>).mockResolvedValue({ cards: [{ id: 1 }] });

    const { NavDrawer: NavDrawerFresh } = await import("@/components/NavDrawer");
    const user = userEvent.setup();

    render(<NavDrawerFresh />);

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });
});
