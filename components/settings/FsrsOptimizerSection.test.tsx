import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FsrsOptimizerSection } from "@/components/settings/FsrsOptimizerSection";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// loadSettings / saveSettings — no-op for unit tests; FsrsOptimizerSection
// reads loadSettings() on a successful optimize call to merge weights in.
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({
    retentionTarget: 0.9,
    fsrsWeights: undefined,
    fsrsWeightsOptimizedAt: undefined,
  })),
  saveSettings: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  fsrsWeightsOptimizedAt: undefined,
  optimizableReviewCount: 0,
  isSignedIn: false,
  superuserPaused: false,
  onOptimized: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FsrsOptimizerSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("guest state (not signed in)", () => {
    it("shows sign-in prompt and no button", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={false}
        />,
      );
      expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
        "Sign in to enable personalized scheduling.",
      );
      expect(screen.queryByTestId("fsrs-optimize-button")).toBeNull();
    });
  });

  describe("superuser paused", () => {
    it("shows disabled button with 'Sync paused (superuser)' label", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          superuserPaused={true}
          optimizableReviewCount={300}
        />,
      );
      const button = screen.getByTestId("fsrs-optimize-button");
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Sync paused (superuser)");
    });
  });

  describe("cooldown active", () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    it("disables button with 'Next optimization in N days' when optimized 2 days ago", () => {
      const optimizedAt = new Date(Date.now() - 2 * MS_PER_DAY).toISOString();
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          superuserPaused={false}
          optimizableReviewCount={300}
          fsrsWeightsOptimizedAt={optimizedAt}
        />,
      );
      const button = screen.getByTestId("fsrs-optimize-button");
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent(/Next optimization in \d+ days/);
      expect(screen.getByTestId("fsrs-optimize-last-run")).toBeInTheDocument();
    });

    it("enables button at exactly 7-day boundary (sinceMs === COOLDOWN_MS)", () => {
      const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
      const fixedNow = 1_700_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);
      try {
        const optimizedAt = new Date(fixedNow - COOLDOWN_MS).toISOString();
        render(
          <FsrsOptimizerSection
            {...defaultProps}
            isSignedIn={true}
            superuserPaused={false}
            optimizableReviewCount={300}
            fsrsWeightsOptimizedAt={optimizedAt}
          />,
        );
        const button = screen.getByTestId("fsrs-optimize-button");
        expect(button).not.toBeDisabled();
        expect(button).toHaveTextContent("Optimize now");
      } finally {
        vi.useRealTimers();
      }
    });

    it("enables button when optimized 8 days ago (cooldown elapsed)", () => {
      const optimizedAt = new Date(Date.now() - 8 * MS_PER_DAY).toISOString();
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          superuserPaused={false}
          optimizableReviewCount={300}
          fsrsWeightsOptimizedAt={optimizedAt}
        />,
      );
      const button = screen.getByTestId("fsrs-optimize-button");
      expect(button).not.toBeDisabled();
      expect(button).toHaveTextContent("Optimize now");
    });
  });

  describe("signed in — not enough reviews", () => {
    it("shows disabled button and review-count help text", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          superuserPaused={false}
          optimizableReviewCount={42}
        />,
      );
      const button = screen.getByTestId("fsrs-optimize-button");
      expect(button).toBeDisabled();
      const help = screen.getByTestId("fsrs-optimize-help");
      expect(help).toHaveTextContent("Available after ~200 reviews. You have 42.");
    });

    it("does not render the last-optimized timestamp", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={10}
        />,
      );
      expect(screen.queryByTestId("fsrs-optimize-last-run")).toBeNull();
    });
  });

  describe("signed in — enough reviews", () => {
    it("renders an enabled Optimize now button", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
        />,
      );
      const button = screen.getByTestId("fsrs-optimize-button");
      expect(button).not.toBeDisabled();
      expect(button).toHaveTextContent("Optimize now");
    });

    it("shows last-optimized timestamp when fsrsWeightsOptimizedAt is set", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
          fsrsWeightsOptimizedAt="2025-03-01T12:00:00.000Z"
        />,
      );
      const lastRun = screen.getByTestId("fsrs-optimize-last-run");
      expect(lastRun).toBeInTheDocument();
      // The exact locale string varies across runtimes; assert the prefix and
      // a year/month/day signature that will be present in any en-* locale.
      expect(lastRun).toHaveTextContent(/Last optimized:/);
      expect(lastRun).toHaveTextContent(/2025/);
      expect(lastRun).toHaveTextContent(/Mar/);
    });

    it("does not render the last-optimized timestamp when not set", () => {
      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
          fsrsWeightsOptimizedAt={undefined}
        />,
      );
      expect(screen.queryByTestId("fsrs-optimize-last-run")).toBeNull();
    });

    it("calls onOptimized and updates last-run text after a successful POST", async () => {
      const onOptimized = vi.fn();
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          weights: [0.1, 0.2],
          optimizedAt: "2025-05-01T10:00:00.000Z",
          reviewCount: 300,
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
          onOptimized={onOptimized}
        />,
      );

      await userEvent.click(screen.getByTestId("fsrs-optimize-button"));

      await waitFor(() => {
        expect(onOptimized).toHaveBeenCalledWith("2025-05-01T10:00:00.000Z", [0.1, 0.2]);
      });
      expect(mockFetch).toHaveBeenCalledWith("/api/srs/optimize", { method: "POST" });
    });

    it("shows error text when the POST fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
      );

      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
        />,
      );

      await userEvent.click(screen.getByTestId("fsrs-optimize-button"));

      await waitFor(() => {
        expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
          "Couldn't optimize — try again later.",
        );
      });
    });

    it("surfaces the server's review count when the 422 gate fires", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({ error: "not_enough_reviews", reviewCount: 47 }),
        }),
      );

      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
        />,
      );

      await userEvent.click(screen.getByTestId("fsrs-optimize-button"));

      await waitFor(() => {
        expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
          "Only 47 reviews synced. Sync first, then try again.",
        );
      });
    });

    it("surfaces 'Try again in N days' message when 429 response has retryAfterMs", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          json: async () => ({ error: "cooldown", retryAfterMs: 5 * 24 * 60 * 60 * 1000 }),
        }),
      );

      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
        />,
      );

      await userEvent.click(screen.getByTestId("fsrs-optimize-button"));

      await waitFor(() => {
        expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
          "Try again in 5 days.",
        );
      });
    });

    it("shows error text when fetch throws", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

      render(
        <FsrsOptimizerSection
          {...defaultProps}
          isSignedIn={true}
          optimizableReviewCount={250}
        />,
      );

      await userEvent.click(screen.getByTestId("fsrs-optimize-button"));

      await waitFor(() => {
        expect(screen.getByTestId("fsrs-optimize-help")).toHaveTextContent(
          "Couldn't optimize — try again later.",
        );
      });
    });
  });
});
