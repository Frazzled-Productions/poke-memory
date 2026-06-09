/**
 * Component tests for app/global-error.tsx (follow-up #1822).
 *
 * global-error.tsx replaces the root layout when the root layout itself throws,
 * so it renders its own <html> and <body> tags. jsdom moves those into the
 * existing document structure, which may emit console warnings about invalid
 * nesting. We suppress those and assert on the Sentry capture call plus the
 * fallback text content rather than ARIA queries that depend on the DOM shape.
 *
 * Tests do NOT use renderWithIntl / next-intl because global-error runs outside
 * the normal provider tree. The component intentionally uses hardcoded English
 * strings (added to the i18n-leak allowlist).
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/link - no App Router context available in jsdom.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href, style }: { children: React.ReactNode; href: string; style?: React.CSSProperties }) => (
    <a href={href} style={style}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Mock @sentry/nextjs so we can assert captureException is called.
// ---------------------------------------------------------------------------

const mockCaptureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import GlobalError from "@/app/global-error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeError = Object.assign(new Error("root layout exploded"), {
  digest: "digest-xyz",
});

const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCaptureException.mockClear();
  // Suppress the jsdom console error about invalid <html>/<body> nesting
  // produced when RTL renders a component that outputs its own html/body tags.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GlobalError - Sentry capture", () => {
  it("calls Sentry.captureException with the error on mount", () => {
    act(() => {
      render(<GlobalError error={fakeError} reset={noop} />);
    });

    expect(mockCaptureException).toHaveBeenCalledOnce();
    expect(mockCaptureException).toHaveBeenCalledWith(fakeError);
  });

  it("calls Sentry.captureException again when the error prop changes", () => {
    const { rerender } = render(<GlobalError error={fakeError} reset={noop} />);
    expect(mockCaptureException).toHaveBeenCalledTimes(1);

    const newError = new Error("another root error");
    act(() => {
      rerender(<GlobalError error={newError} reset={noop} />);
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(2);
    expect(mockCaptureException).toHaveBeenLastCalledWith(newError);
  });
});

describe("GlobalError - fallback UI", () => {
  it("renders a fallback heading", () => {
    act(() => {
      render(<GlobalError error={fakeError} reset={noop} />);
    });

    // Query via document because jsdom may relocate <html>/<body> children.
    expect(document.body.textContent).toMatch(/something went wrong/i);
  });

  it("renders the apologetic body copy", () => {
    act(() => {
      render(<GlobalError error={fakeError} reset={noop} />);
    });

    expect(document.body.textContent).toMatch(
      /an unexpected error occurred/i,
    );
  });

  it("renders a Try again button", () => {
    act(() => {
      render(<GlobalError error={fakeError} reset={noop} />);
    });

    // The button may or may not be queryable via screen depending on how
    // jsdom restructures the html/body. Fall back to document query.
    const tryAgain =
      screen.queryByRole("button", { name: /try again/i }) ??
      document.querySelector("button");
    expect(tryAgain).not.toBeNull();
    expect(tryAgain?.textContent).toMatch(/try again/i);
  });

  it("renders a Go to home link pointing to /", () => {
    act(() => {
      render(<GlobalError error={fakeError} reset={noop} />);
    });

    const link =
      screen.queryByRole("link", { name: /go to home/i }) ??
      (document.querySelector("a[href='/']") as HTMLAnchorElement | null);
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/");
  });

  it("calls reset when Try again is clicked", () => {
    const reset = vi.fn();
    act(() => {
      render(<GlobalError error={fakeError} reset={reset} />);
    });

    const btn =
      screen.queryByRole("button", { name: /try again/i }) ??
      document.querySelector("button");
    expect(btn).not.toBeNull();
    btn?.click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("does not expose error details in production mode", () => {
    // NODE_ENV is 'test', treated as non-development, so the error.message
    // <pre> block must not render.
    act(() => {
      render(<GlobalError error={fakeError} reset={noop} />);
    });

    // The raw error message appears in the dev-only <pre>; it must not appear
    // in production-like builds. NODE_ENV=test counts as non-dev.
    const pre = document.querySelector("pre");
    expect(pre).toBeNull();
  });
});
