/**
 * Component tests for NavLinks (issue #852).
 *
 * Covers:
 *   - The Journey link is present in the nav.
 *   - Active link carries aria-current="page".
 *   - Pasture link appears when pretendAllMastered flag is on.
 *   - Pasture link hidden when hasMastered=false and flag is off.
 *   - NavLinksFallback renders the same static links (including Journey).
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

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ masteryRepetitions: 3 })),
}));

vi.mock("@/lib/review/useSessionStorageKey", () => ({
  useSessionStorageKey: vi.fn().mockReturnValue(0),
}));

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

import { NavLinks, NavLinksFallback } from "@/components/NavLinks";

// ---------------------------------------------------------------------------

beforeEach(() => {
  mockPathname.value = "/";
  mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: false } });
});

describe("NavLinks", () => {
  it("renders the Journey link", async () => {
    render(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    });
  });

  it("includes all core nav links", () => {
    render(<NavLinks />);

    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the active link with aria-current='page' for /journey", async () => {
    mockPathname.value = "/journey";

    render(<NavLinks />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Journey" }),
      ).toHaveAttribute("aria-current", "page");
    });

    expect(
      screen.getByRole("link", { name: "Practice" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marks the active link with aria-current='page' for /stats", async () => {
    mockPathname.value = "/stats";

    render(<NavLinks />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Stats" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });

  it("does not show the Pasture link when hasMastered=false and flag=off", async () => {
    render(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();
  });

  it("shows the Pasture link when pretendAllMastered flag is on", async () => {
    mockUseSuperuser.mockReturnValue({ flags: { pretendAllMastered: true } });

    render(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });
});

describe("NavLinksFallback", () => {
  it("renders all static links including Journey", () => {
    render(<NavLinksFallback />);

    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});
