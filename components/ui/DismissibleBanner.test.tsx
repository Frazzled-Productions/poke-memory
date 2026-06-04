/**
 * DismissibleBanner component tests.
 *
 * State coverage: both "red" and "amber" variants, message rendering, dismiss
 * button fires onDismiss, aria-label present on the dismiss button.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DismissibleBanner } from "@/components/ui/DismissibleBanner";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DismissibleBanner", () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it("renders the message text", () => {
    render(
      <DismissibleBanner
        variant="red"
        message="Something went wrong"
        dismissLabel="Dismiss error"
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders a dismiss button with the provided aria-label", () => {
    render(
      <DismissibleBanner
        variant="red"
        message="Something went wrong"
        dismissLabel="Dismiss error"
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Dismiss error" })).toBeInTheDocument();
  });

  it("has role=alert on the wrapper", () => {
    render(
      <DismissibleBanner
        variant="amber"
        message="Storage is full"
        dismissLabel="Dismiss warning"
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Dismiss interaction
  // -------------------------------------------------------------------------

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const handleDismiss = vi.fn();
    render(
      <DismissibleBanner
        variant="red"
        message="Something went wrong"
        dismissLabel="Dismiss error"
        onDismiss={handleDismiss}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(handleDismiss).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Colour variants
  // -------------------------------------------------------------------------

  it("applies red colour classes on the wrapper when variant=red", () => {
    render(
      <DismissibleBanner
        variant="red"
        message="Error"
        dismissLabel="Dismiss"
        onDismiss={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("border-red-200");
    expect(alert.className).toContain("bg-red-50");
    expect(alert.className).toContain("text-red-800");
  });

  it("applies red colour classes on the dismiss button when variant=red", () => {
    render(
      <DismissibleBanner
        variant="red"
        message="Error"
        dismissLabel="Dismiss error"
        onDismiss={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: "Dismiss error" });
    expect(btn.className).toContain("text-red-600");
    expect(btn.className).toContain("hover:text-red-800");
    expect(btn.className).toContain("focus-visible:ring-red-400");
  });

  it("applies amber colour classes on the wrapper when variant=amber", () => {
    render(
      <DismissibleBanner
        variant="amber"
        message="Storage warning"
        dismissLabel="Dismiss"
        onDismiss={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("border-amber-200");
    expect(alert.className).toContain("bg-amber-50");
    expect(alert.className).toContain("text-amber-800");
  });

  it("applies amber colour classes on the dismiss button when variant=amber", () => {
    render(
      <DismissibleBanner
        variant="amber"
        message="Storage warning"
        dismissLabel="Dismiss warning"
        onDismiss={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: "Dismiss warning" });
    expect(btn.className).toContain("text-amber-600");
    expect(btn.className).toContain("hover:text-amber-800");
    expect(btn.className).toContain("focus-visible:ring-amber-400");
  });

  it("does not apply red classes when variant=amber", () => {
    render(
      <DismissibleBanner
        variant="amber"
        message="Storage warning"
        dismissLabel="Dismiss"
        onDismiss={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).not.toContain("red");
  });

  it("does not apply amber classes when variant=red", () => {
    render(
      <DismissibleBanner
        variant="red"
        message="Error"
        dismissLabel="Dismiss"
        onDismiss={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.className).not.toContain("amber");
  });
});
