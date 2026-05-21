/**
 * Component tests for app/error.tsx (closes #1167).
 *
 * Verifies that the offline-aware variant renders when navigator.onLine is
 * false, and the generic red-box variant renders when online.
 *
 * navigator.onLine is mocked via Object.defineProperty so each branch can be
 * exercised independently without real network state.
 */

import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock next/link — no App Router context available in jsdom.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import ErrorPage from "@/app/error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

const fakeError = Object.assign(new Error("test error"), { digest: "abc123" });
const noop = () => {};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  // Restore to online so other tests aren't affected.
  setOnline(true);
});

describe("Error page — online variant", () => {
  it("renders the generic red-box heading when online", () => {
    setOnline(true);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
  });

  it("renders the Try again button when online", () => {
    setOnline(true);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("calls reset when Try again is clicked (online)", async () => {
    setOnline(true);
    const reset = vi.fn();
    render(<ErrorPage error={fakeError} reset={reset} />);

    screen.getByRole("button", { name: /try again/i }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("does not render the offline heading when online", () => {
    setOnline(true);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("heading", { name: /you're offline/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Error page — offline variant", () => {
  it("renders the offline heading when navigator.onLine is false", () => {
    setOnline(false);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /you're offline/i }),
    ).toBeInTheDocument();
  });

  it("renders the offline body copy", () => {
    setOnline(false);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByText(/some pages aren't available without a connection/i),
    ).toBeInTheDocument();
  });

  it("renders a Try again button when offline", () => {
    setOnline(false);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it("calls reset when Try again is clicked (offline)", () => {
    setOnline(false);
    const reset = vi.fn();
    render(<ErrorPage error={fakeError} reset={reset} />);

    screen.getByRole("button", { name: /try again/i }).click();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("renders a Go to practice link pointing to /practice", () => {
    setOnline(false);
    render(<ErrorPage error={fakeError} reset={noop} />);

    const link = screen.getByRole("link", { name: /go to practice/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/practice");
  });

  it("does not render the generic error heading when offline", () => {
    setOnline(false);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.queryByRole("heading", { name: /something went wrong/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to the online variant when an online event fires", () => {
    setOnline(false);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /you're offline/i }),
    ).toBeInTheDocument();

    // Simulate connectivity restored.
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /you're offline/i }),
    ).not.toBeInTheDocument();
  });

  it("switches to the offline variant when an offline event fires", () => {
    setOnline(true);
    render(<ErrorPage error={fakeError} reset={noop} />);

    expect(
      screen.getByRole("heading", { name: /something went wrong/i }),
    ).toBeInTheDocument();

    // Simulate connectivity lost.
    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(
      screen.getByRole("heading", { name: /you're offline/i }),
    ).toBeInTheDocument();
  });
});
