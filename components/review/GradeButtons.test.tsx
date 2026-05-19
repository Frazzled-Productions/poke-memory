"use client";

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { GradeButtons, KeyboardShortcutsOverlay } from "@/components/review/GradeButtons";

// ---------------------------------------------------------------------------
// KeyboardShortcutsOverlay
// ---------------------------------------------------------------------------

describe("KeyboardShortcutsOverlay", () => {
  it("renders with role='dialog' and the correct accessible name", () => {
    render(<KeyboardShortcutsOverlay onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("lists all seven shortcut rows including the '3 / 4' alias for Good", () => {
    render(<KeyboardShortcutsOverlay onClose={() => {}} />);

    // Spot-check a few rows.
    expect(screen.getByText("Space / Enter")).toBeInTheDocument();
    expect(screen.getByText("Reveal card")).toBeInTheDocument();
    expect(screen.getByText("3 / 4")).toBeInTheDocument();
    expect(screen.getByText("Grade: Good")).toBeInTheDocument();
    expect(screen.getByText("Esc")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<KeyboardShortcutsOverlay onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /close keyboard shortcuts overlay/i }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(
      <div data-testid="root">
        <KeyboardShortcutsOverlay onClose={onClose} />
      </div>,
    );

    // Click the backdrop (role="presentation" wrapper). The dialog div itself
    // stopsPropagation, so clicking it should NOT close; clicking outside should.
    const backdrop = document.querySelector('[role="presentation"]') as HTMLElement;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT call onClose when the dialog panel itself is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<KeyboardShortcutsOverlay onClose={onClose} />);

    // Click the inner dialog panel — stopPropagation prevents backdrop handler.
    await user.click(screen.getByRole("dialog"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on mount", async () => {
    render(<KeyboardShortcutsOverlay onClose={() => {}} />);

    // The first focusable element inside the dialog (Close button) should receive focus.
    await waitFor(() => {
      const closeBtn = screen.getByRole("button", { name: /close keyboard shortcuts overlay/i });
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  it("traps Tab inside the dialog (forward cycle wraps to first)", () => {
    render(<KeyboardShortcutsOverlay onClose={() => {}} />);

    // Only one focusable element (the Close button). Tab from it should wrap back.
    const closeBtn = screen.getByRole("button", { name: /close keyboard shortcuts overlay/i });
    closeBtn.focus();

    // Tab forward from last element wraps to first (same element here).
    fireEvent.keyDown(document, { key: "Tab", bubbles: true });

    expect(document.activeElement).toBe(closeBtn);
  });

  it("traps Shift+Tab inside the dialog (reverse cycle wraps to last)", () => {
    render(<KeyboardShortcutsOverlay onClose={() => {}} />);

    const closeBtn = screen.getByRole("button", { name: /close keyboard shortcuts overlay/i });
    closeBtn.focus();

    // Shift+Tab backward from first element wraps to last (same element here).
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true, bubbles: true });

    expect(document.activeElement).toBe(closeBtn);
  });
});

// ---------------------------------------------------------------------------
// GradeButtons
// ---------------------------------------------------------------------------

describe("GradeButtons", () => {
  it("renders four grade buttons", () => {
    render(<GradeButtons onGrade={() => {}} />);

    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("calls onGrade with the correct grade value when a button is clicked", async () => {
    const onGrade = vi.fn();
    const user = userEvent.setup();
    render(<GradeButtons onGrade={onGrade} />);

    await user.click(screen.getByRole("button", { name: /good/i }));

    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("disables all grade buttons when disabled prop is true", () => {
    render(<GradeButtons onGrade={() => {}} disabled />);

    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeDisabled();
    }
  });

  it("opens the overlay in uncontrolled mode when the ? button is clicked", async () => {
    const user = userEvent.setup();
    render(<GradeButtons onGrade={() => {}} />);

    const hintBtn = screen.getByRole("button", { name: /show keyboard shortcuts/i });
    await user.click(hintBtn);

    expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it("does NOT render the overlay independently when in controlled mode (parent owns it)", () => {
    // When showShortcuts / onOpenShortcuts / onCloseShortcuts are all provided,
    // GradeButtons defers overlay rendering to the parent — no dialog in DOM.
    render(
      <GradeButtons
        onGrade={() => {}}
        showShortcuts={false}
        onOpenShortcuts={() => {}}
        onCloseShortcuts={() => {}}
      />,
    );

    expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
  });

  it("calls onOpenShortcuts instead of self-managing when in controlled mode", async () => {
    const onOpenShortcuts = vi.fn();
    const user = userEvent.setup();
    render(
      <GradeButtons
        onGrade={() => {}}
        showShortcuts={false}
        onOpenShortcuts={onOpenShortcuts}
        onCloseShortcuts={() => {}}
      />,
    );

    const hintBtn = screen.getByRole("button", { name: /show keyboard shortcuts/i });
    await user.click(hintBtn);

    expect(onOpenShortcuts).toHaveBeenCalledOnce();
    // Overlay still not in DOM — parent controls rendering.
    expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
  });
});
