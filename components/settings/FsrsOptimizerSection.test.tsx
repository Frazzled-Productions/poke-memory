import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";
import { FsrsOptimizerSection, OPTIMISER_PAGE_PATH } from "@/components/settings/FsrsOptimizerSection";
import { OPTIMIZER_COOLDOWN_MS } from "@/lib/srs/optimizer";
import { loadSettings } from "@/lib/settings/persistence";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import ja from "@/messages/ja.json";
import zhHans from "@/messages/zh-Hans.json";
import zhHant from "@/messages/zh-Hant.json";

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ retentionTarget: 0.9 })),
}));

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const defaultProps = {
  fsrsWeightsOptimizedAt: undefined,
  optimizableReviewCount: 0,
  isSignedIn: false,
  superuserPaused: false,
};

describe("FsrsOptimizerSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("guest: shows the sign-in prompt and no button or link", () => {
    renderWithIntl(<FsrsOptimizerSection {...defaultProps} />);
    expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
      "Sign in to enable personalised scheduling.",
    );
    expect(screen.queryByTestId("fsrs-optimize-button")).toBeNull();
    expect(screen.queryByTestId("fsrs-optimize-link")).toBeNull();
  });

  it("superuser: shows a disabled 'Sync paused (superuser)' button and no link", () => {
    renderWithIntl(
      <FsrsOptimizerSection {...defaultProps} isSignedIn superuserPaused optimizableReviewCount={300} />,
    );
    const button = screen.getByTestId("fsrs-optimize-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Sync paused (superuser)");
    expect(screen.queryByTestId("fsrs-optimize-link")).toBeNull();
  });

  it("not enough reviews: disabled button and the review count", () => {
    renderWithIntl(<FsrsOptimizerSection {...defaultProps} isSignedIn optimizableReviewCount={42} />);
    expect(screen.getByTestId("fsrs-optimize-button")).toBeDisabled();
    expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
      "Available after about 200 reviews. You have 42.",
    );
    expect(screen.queryByTestId("fsrs-optimize-last-run")).toBeNull();
  });

  it("cooldown: disabled button with the days left, and the last run", () => {
    const optimizedAt = new Date(Date.now() - 2 * MS_PER_DAY).toISOString();
    renderWithIntl(
      <FsrsOptimizerSection
        {...defaultProps}
        isSignedIn
        optimizableReviewCount={300}
        fsrsWeightsOptimizedAt={optimizedAt}
      />,
    );
    const button = screen.getByTestId("fsrs-optimize-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Next optimisation in 5 days");
    expect(screen.getByTestId("fsrs-optimize-last-run")).toHaveTextContent(/Last optimised:/);
  });

  it("ready at exactly the 7-day boundary: links to the optimiser page", () => {
    const fixedNow = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    try {
      renderWithIntl(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn
          optimizableReviewCount={300}
          fsrsWeightsOptimizedAt={new Date(fixedNow - OPTIMIZER_COOLDOWN_MS).toISOString()}
        />,
      );
      expect(screen.queryByTestId("fsrs-optimize-button")).toBeNull();
      expect(screen.getByTestId("fsrs-optimize-link")).toHaveTextContent("Optimise now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ready: a plain link (full page load) to /settings/optimiser", () => {
    renderWithIntl(<FsrsOptimizerSection {...defaultProps} isSignedIn optimizableReviewCount={250} />);
    const link = screen.getByRole("link", { name: "Optimise now" });
    expect(link).toHaveAttribute("href", OPTIMISER_PAGE_PATH);
    expect(OPTIMISER_PAGE_PATH).toBe("/settings/optimiser");
    expect(screen.queryByTestId("fsrs-optimize-last-run")).toBeNull();
  });

  it("renders the last-optimised date in the user's configured timezone, not UTC", () => {
    // 23:30 UTC on 1 Mar is already 2 Mar in Asia/Tokyo (UTC+9) (#1456).
    vi.mocked(loadSettings).mockReturnValueOnce({
      retentionTarget: 0.9,
      timezone: "Asia/Tokyo",
    } as ReturnType<typeof loadSettings>);
    renderWithIntl(
      <FsrsOptimizerSection
        {...defaultProps}
        isSignedIn
        optimizableReviewCount={250}
        fsrsWeightsOptimizedAt="2025-03-01T23:30:00.000Z"
      />,
    );
    expect(screen.getByTestId("fsrs-optimize-last-run")).toHaveTextContent(/2 Mar 2025/);
  });
});

describe("FsrsOptimizerSection - locale coverage", () => {
  const catalogues = { ja, "zh-Hans": zhHans, "zh-Hant": zhHant } as const;

  it.each(SUPPORTED_LOCALES.filter((l) => l !== "en"))(
    "%s: heading, link and help text come from the catalogue",
    (locale) => {
      const m = catalogues[locale as keyof typeof catalogues].settings.optimiser;
      renderWithIntl(<FsrsOptimizerSection {...defaultProps} isSignedIn optimizableReviewCount={250} />, {
        locale,
      });
      expect(screen.getByRole("heading", { name: m.heading })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: m.optimiseNow })).toBeInTheDocument();
      expect(screen.getByText(m.intro)).toBeInTheDocument();
    },
  );

  it.each(SUPPORTED_LOCALES.filter((l) => l !== "en"))("%s: guest prompt is translated", (locale) => {
    const m = catalogues[locale as keyof typeof catalogues].settings.optimiser;
    renderWithIntl(<FsrsOptimizerSection {...defaultProps} />, { locale });
    expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(m.signInPrompt);
  });
});
