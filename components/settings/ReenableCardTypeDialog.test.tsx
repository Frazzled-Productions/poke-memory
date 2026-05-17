import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReenableCardTypeDialog } from "@/components/settings/ReenableCardTypeDialog";

// jsdom does not implement HTMLDialogElement.showModal / close. Polyfill them
// so the dialog mounts; the open/closed state is what the component drives.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

describe("ReenableCardTypeDialog (#835)", () => {
  it("renders the card type name in the heading", () => {
    render(
      <ReenableCardTypeDialog
        open
        cardTypeName="reverse cards"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /re-enable reverse cards/i }),
    ).toBeInTheDocument();
  });

  it("shows both choice buttons and a cancel button", () => {
    render(
      <ReenableCardTypeDialog
        open
        cardTypeName="cry cards"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /reuse my saved progress/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start fresh/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("calls onChoose('reuse') when the reuse button is clicked", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(
      <ReenableCardTypeDialog
        open
        cardTypeName="name cards"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );
    await user.click(screen.getByRole("button", { name: /reuse my saved progress/i }));
    expect(onChoose).toHaveBeenCalledWith("reuse");
  });

  it("calls onChoose('fresh') when the start-fresh button is clicked", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(
      <ReenableCardTypeDialog
        open
        cardTypeName="evolution cards"
        onClose={vi.fn()}
        onChoose={onChoose}
      />,
    );
    await user.click(screen.getByRole("button", { name: /start fresh/i }));
    expect(onChoose).toHaveBeenCalledWith("fresh");
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ReenableCardTypeDialog
        open
        cardTypeName="reverse cards"
        onClose={onClose}
        onChoose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not expose interactive buttons in the accessible tree when closed", () => {
    render(
      <ReenableCardTypeDialog
        open={false}
        cardTypeName="name cards"
        onClose={vi.fn()}
        onChoose={vi.fn()}
      />,
    );
    // jsdom renders the <dialog> element but does not mark it as open, so the
    // native element is in the DOM but the dialog is not open. The heading is
    // present in the DOM but not accessible as a role when the dialog is closed.
    // Verify neither choice button is accessible (not in the accessibility tree).
    expect(screen.queryByRole("button", { name: /reuse my saved progress/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /start fresh/i })).toBeNull();
  });
});
