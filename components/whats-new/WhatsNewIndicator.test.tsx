/**
 * Tests for WhatsNewIndicator.
 *
 * Covers the localised aria-label added in #1607 and the two primary render
 * states (hidden vs visible).
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// next/link: strip to a plain <a> so getByRole("link") works in jsdom.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// next/navigation: usePathname returns a non-whats-new path so the indicator
// is not suppressed by the "on the whats-new page already" guard.
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// lib/version helpers: mocked so tests don't depend on localStorage state.
const { mockReadLastSeenVersion, mockWriteLastSeenVersion, MOCK_LAST_SEEN_VERSION_KEY } =
  vi.hoisted(() => ({
    mockReadLastSeenVersion: vi.fn<() => string | null>(),
    mockWriteLastSeenVersion: vi.fn<() => void>(),
    MOCK_LAST_SEEN_VERSION_KEY: "poke-memory:last-seen-version",
  }));

vi.mock("@/lib/version/lastSeen", () => ({
  readLastSeenVersion: () => mockReadLastSeenVersion(),
  writeLastSeenVersion: (v: string) => mockWriteLastSeenVersion(v),
  LAST_SEEN_VERSION_KEY: MOCK_LAST_SEEN_VERSION_KEY,
}));

// mockCompareSemver is set per-test to control the "newer version available"
// vs "already seen" branch. Default: no unseen changes (returns 0).
const mockCompareSemver = vi.fn<(a: string, b: string) => number>(() => 0);

vi.mock("@/lib/version/compare", () => ({
  compareSemver: (a: string, b: string) => mockCompareSemver(a, b),
}));

// ---------------------------------------------------------------------------
// Import component after mocks.
// ---------------------------------------------------------------------------

import { WhatsNewIndicator } from "@/components/whats-new/WhatsNewIndicator";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WhatsNewIndicator", () => {
  it("renders nothing when last-seen version matches the current build", () => {
    // compareSemver returns 0 when versions match — no unseen changes.
    mockReadLastSeenVersion.mockReturnValue("0.0.1");
    const { container } = renderWithIntl(<WhatsNewIndicator />);
    // After the mount effect resolves hasUnseen stays false → null render.
    expect(container.firstChild).toBeNull();
  });

  it("renders a link with the localised aria-label when there are unseen changes (en)", async () => {
    // The current build is newer than the stored version — compareSemver returns 1.
    mockReadLastSeenVersion.mockReturnValue("0.0.0");
    mockCompareSemver.mockReturnValue(1);
    renderWithIntl(<WhatsNewIndicator />);
    // The link appears once the mount effect sets hasUnseen=true.
    const link = await screen.findByRole("link", { name: "What's new" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/whats-new");
  });

  it("aria-label is localised in Japanese", async () => {
    mockReadLastSeenVersion.mockReturnValue("0.0.0");
    mockCompareSemver.mockReturnValue(1);
    renderJa(<WhatsNewIndicator />);
    const link = await screen.findByRole("link", { name: "新機能" });
    expect(link).toBeInTheDocument();
  });

  it("renders nothing when last-seen is null (first visit) — seeds the version silently", () => {
    // No stored version = first visit. The component seeds APP_VERSION and
    // keeps hasUnseen=false so the pill is not shown to brand-new users.
    mockReadLastSeenVersion.mockReturnValue(null);
    const { container } = renderWithIntl(<WhatsNewIndicator />);
    expect(container.firstChild).toBeNull();
    expect(mockWriteLastSeenVersion).toHaveBeenCalledTimes(1);
  });
});
