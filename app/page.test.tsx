/**
 * Smoke tests for the Practice (Home) page.
 *
 * Covers the wide-viewport layout changes added in #1061 — specifically the
 * three-column grid wrapper and the PracticeSidebar slot added to app/page.tsx.
 * The heavy child components are stubbed so the render is fast and focused on
 * the shell structure that the diff-coverage gate flags.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before the component import so vi.mock hoisting applies.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Stub the heavy client components that pull in SRS, IDB, audio, etc.
// The page shell is what the diff-coverage gate tracks, not the children.
vi.mock("@/components/review/ReviewSession", () => ({
  ReviewSession: () => <div data-testid="review-session" />,
}));

vi.mock("@/components/review/PracticeSidebar", () => ({
  PracticeSidebar: () => <div data-testid="practice-sidebar" />,
}));

vi.mock("@/components/review/StreakBadge", () => ({
  StreakBadge: () => <div data-testid="streak-badge" />,
}));

vi.mock("@/components/onboarding/FirstVisitOnboardingModal", () => ({
  FirstVisitOnboardingModal: () => <div data-testid="first-visit-onboarding-modal" />,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import Home from "@/app/page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a value in a never-resolving Promise to simulate server params. */
function pendingSearchParams() {
  return new Promise<{ error?: string }>(() => {}) as Promise<{ error?: string }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Practice page (Home) — layout shell", () => {
  it("renders the ReviewSession and PracticeSidebar slots", () => {
    render(<Home searchParams={pendingSearchParams()} />);

    expect(screen.getByTestId("review-session")).toBeInTheDocument();
    expect(screen.getByTestId("practice-sidebar")).toBeInTheDocument();
  });

  it("renders the StreakBadge and FirstVisitOnboardingModal", () => {
    render(<Home searchParams={pendingSearchParams()} />);

    expect(screen.getByTestId("streak-badge")).toBeInTheDocument();
    expect(screen.getByTestId("first-visit-onboarding-modal")).toBeInTheDocument();
  });

  it("renders the PracticeSidebar inside the wide-viewport grid column", () => {
    const { container } = render(<Home searchParams={pendingSearchParams()} />);

    // The sidebar wrapper uses `hidden lg:block` — it is always in the DOM.
    const sidebarWrapper = container.querySelector(".hidden.lg\\:block");
    expect(sidebarWrapper).not.toBeNull();

    // The sidebar test-id is reachable (present in DOM even if CSS-hidden).
    expect(screen.getByTestId("practice-sidebar")).toBeInTheDocument();
  });
});
