/**
 * Smoke tests for the Practice (Home) page.
 *
 * Covers the wide-viewport layout changes added in #1061 - specifically the
 * three-column grid wrapper and the PracticeSidebar slot added to app/page.tsx.
 * The heavy child components are stubbed so the render is fast and focused on
 * the shell structure that the diff-coverage gate flags.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks - declared before the component import so vi.mock hoisting applies.
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

// Mock next-intl/server so getTranslations resolves synchronously in jsdom.
// AuthErrorBanner (async server component) uses getTranslations("practice").
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const catalogues: Record<string, Record<string, string>> = {
      nav: { practice: "Practice", whatsNew: "What's new" },
      practice: { signInFailed: "Sign-in failed. Please try again." },
    };
    const ns = catalogues[namespace] ?? {};
    return (key: string) => ns[key] ?? key;
  },
}));

// Mock PracticeH1 client component so it renders the h1 without needing
// the full Next-intl client provider. The page.test uses bare `render`.
vi.mock("@/components/practice/PracticeH1", () => ({
  PracticeH1: () => <h1 className="sr-only">Practice</h1>,
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

describe("Practice page (Home) - layout shell", () => {
  it("renders the ReviewSession and PracticeSidebar slots", () => {
    render(<Home searchParams={pendingSearchParams()} />);

    expect(screen.getByTestId("review-session")).toBeInTheDocument();
    expect(screen.getByTestId("practice-sidebar")).toBeInTheDocument();
  });

  it("renders a visually-hidden sr-only h1 with accessible name 'Practice' (#1730)", () => {
    // PracticeH1 is mocked to render synchronously in jsdom.
    render(<Home searchParams={pendingSearchParams()} />);

    const h1 = screen.getByRole("heading", { level: 1, name: "Practice" });
    expect(h1).toBeInTheDocument();
    expect(h1).toHaveClass("sr-only");
  });

  it("renders the StreakBadge and FirstVisitOnboardingModal", () => {
    render(<Home searchParams={pendingSearchParams()} />);

    expect(screen.getByTestId("streak-badge")).toBeInTheDocument();
    expect(screen.getByTestId("first-visit-onboarding-modal")).toBeInTheDocument();
  });

  it("renders the PracticeSidebar inside the wide-viewport grid column", () => {
    const { container } = render(<Home searchParams={pendingSearchParams()} />);

    // The sidebar wrapper uses `hidden lg:block` - it is always in the DOM.
    const sidebarWrapper = container.querySelector(".hidden.lg\\:block");
    expect(sidebarWrapper).not.toBeNull();

    // The sidebar test-id is reachable (present in DOM even if CSS-hidden).
    expect(screen.getByTestId("practice-sidebar")).toBeInTheDocument();
  });
});

/**
 * jsdom cannot render async server components, so find AuthErrorBanner in the
 * tree Home returns, call it with the page's searchParams and render its output.
 */
async function renderBanner(searchParams: { error?: string }) {
  type El = { type?: unknown; props?: { children?: unknown; searchParams?: unknown } };
  const find = (node: unknown): El | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    const el = node as El;
    if (typeof el.type === "function" && el.type.name === "AuthErrorBanner") return el;
    return find(el.props?.children);
  };
  const banner = find(Home({ searchParams: Promise.resolve(searchParams) }));
  if (!banner) throw new Error("AuthErrorBanner not found in Home");
  const output = await (banner.type as (p: unknown) => Promise<React.ReactElement | null>)(banner.props);
  return render(<>{output}</>);
}

describe("Practice page (Home) - sign-in error banner", () => {
  it.each(["auth", "access_denied", "state_mismatch"])("alerts for ?error=%s (Better Auth sends its own codes)", async (error) => {
    await renderBanner({ error });

    expect(screen.getByRole("alert")).toHaveTextContent("Sign-in failed. Please try again.");
  });

  it("shows no alert without an error", async () => {
    await renderBanner({});

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
