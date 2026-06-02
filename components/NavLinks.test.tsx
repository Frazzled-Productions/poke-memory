/**
 * Component tests for NavLinks (issue #852, #1369 i18n wiring, #1516 hook
 * extraction).
 *
 * Covers:
 *   - The Journey link is present in the nav.
 *   - Active link carries aria-current="page".
 *   - Pasture link appears when usePastureMasteryState returns showPasture=true.
 *   - Pasture link hidden when showPasture=false (default).
 *   - NavLinksFallback renders the same static links (including Journey).
 *   - Japanese locale renders the correct translated label (練習 for Practice).
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

const mockUsePastureMasteryState = vi.fn(() => ({ showPasture: false }));
vi.mock("@/lib/pasture/usePastureMasteryState", () => ({
  usePastureMasteryState: () => mockUsePastureMasteryState(),
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
  mockUsePastureMasteryState.mockReturnValue({ showPasture: false });
});

describe("NavLinks", () => {
  it("renders the Journey link", async () => {
    renderWithIntl(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    });
  });

  it("includes all core nav links", () => {
    renderWithIntl(<NavLinks />);

    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("marks the active link with aria-current='page' for /journey", async () => {
    mockPathname.value = "/journey";

    renderWithIntl(<NavLinks />);

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

    renderWithIntl(<NavLinks />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Stats" }),
      ).toHaveAttribute("aria-current", "page");
    });
  });

  it("does not show the Pasture link when hasMastered=false and flag=off", async () => {
    renderWithIntl(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Pasture" })).toBeNull();
  });

  it("shows the Pasture link when usePastureMasteryState returns showPasture=true", async () => {
    mockUsePastureMasteryState.mockReturnValue({ showPasture: true });

    renderWithIntl(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Pasture" })).toBeInTheDocument();
    });
  });
});

describe("NavLinksFallback", () => {
  it("renders all static links including Journey", () => {
    renderWithIntl(<NavLinksFallback />);

    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Stats" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pokédex" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("NavLinks — Japanese locale", () => {
  it("renders the Practice link label in Japanese (練習)", async () => {
    renderJa(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "練習" })).toBeInTheDocument();
    });
  });

  it("renders the Pokédex link label in Japanese (図鑑)", async () => {
    renderJa(<NavLinks />);

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "図鑑" })).toBeInTheDocument();
    });
  });
});
