/**
 * Component tests for Nav (issue #1048).
 *
 * Covers:
 *   - The <header> element renders and is present in the document.
 *   - The brand link ("poke-memory") is present and points to "/".
 *   - The main navigation landmark is accessible.
 *
 * The goal is to exercise Nav.tsx line 9 (the <header> with
 * pt-[env(safe-area-inset-top)]) so it registers in v8 coverage.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// next/link — render as a plain anchor in jsdom
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-label": ariaLabel,
    "data-superuser-tap": dataSuperuserTap,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-label"?: string;
    "data-superuser-tap"?: string;
  }) => (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
      data-superuser-tap={dataSuperuserTap}
    >
      {children}
    </a>
  ),
}));

// Stub out the child components so we only test Nav's own render path.
vi.mock("@/components/NavLinks", () => ({
  NavLinks: () => <div data-testid="nav-links" />,
  NavLinksFallback: () => <div data-testid="nav-links-fallback" />,
}));

vi.mock("@/components/theme/FavouriteMascot", () => ({
  FavouriteMascot: () => null,
}));

vi.mock("@/components/MobileNavSlot", () => ({
  MobileNavSlot: () => <div data-testid="mobile-nav-slot" />,
}));

// ---------------------------------------------------------------------------

import { Nav } from "@/components/Nav";

// ---------------------------------------------------------------------------

describe("Nav", () => {
  it("renders the <header> element", () => {
    const { container } = render(<Nav />);

    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
  });

  it("renders the main navigation landmark", () => {
    render(<Nav />);

    expect(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
  });

  it("renders the brand link pointing to the home page", () => {
    render(<Nav />);

    const brand = screen.getByRole("link", { name: /poke-memory/i });
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveAttribute("href", "/");
  });
});
