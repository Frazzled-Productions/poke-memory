/**
 * Component tests for Nav (issue #1048, #1369 i18n wiring).
 *
 * Covers:
 *   - The <header> element renders and is present in the document.
 *   - The brand link ("poke-memory") is present and points to "/".
 *   - The main navigation landmark is accessible.
 *
 * Nav is an async Server Component that calls `getTranslations`. In the jsdom
 * environment we stub `next-intl/server` so `getTranslations` returns a
 * function backed by the real en catalogue keys, then `await` the async
 * component before handing it to `render`.
 *
 * The goal is to exercise Nav.tsx so it registers in v8 coverage.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Stub next-intl/server — getTranslations returns a sync function that looks
// up real English values from messages/en.json so tests match on actual strings.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const enMessages = require("../messages/en.json") as Record<string, Record<string, string>>;
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const ns = enMessages[namespace] ?? {};
    return (key: string) => ns[key] ?? key;
  },
  setRequestLocale: vi.fn(),
  getMessages: async () => enMessages,
}));

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
  it("renders the <header> element", async () => {
    // Nav is an async Server Component — await it, then render the JSX result.
    const { container } = render(await Nav());

    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
  });

  it("renders the main navigation landmark", async () => {
    render(await Nav());

    expect(
      screen.getByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
  });

  it("renders the brand link pointing to the home page", async () => {
    render(await Nav());

    const brand = screen.getByRole("link", { name: /poke-memory/i });
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveAttribute("href", "/");
  });
});
