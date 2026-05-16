import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeleteAccountDialog } from "@/components/settings/DeleteAccountDialog";

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

describe("DeleteAccountDialog", () => {
  it("renders the irreversible-erasure copy", () => {
    render(
      <DeleteAccountDialog open onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: /delete your account/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it("keeps the confirm button disabled until DELETE is typed exactly", async () => {
    const user = userEvent.setup();
    render(
      <DeleteAccountDialog open onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    const confirmBtn = screen.getByRole("button", { name: "Delete account" });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/type delete to confirm/i);
    await user.type(input, "delete");
    expect(confirmBtn).toBeDisabled(); // case-sensitive

    await user.clear(input);
    await user.type(input, "DELETE");
    expect(confirmBtn).toBeEnabled();
  });

  it("calls onConfirm when DELETE is typed and the button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteAccountDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    await user.type(
      screen.getByLabelText(/type delete to confirm/i),
      "DELETE",
    );
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("surfaces an error message when onConfirm rejects", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error("network down"));
    render(
      <DeleteAccountDialog open onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    await user.type(
      screen.getByLabelText(/type delete to confirm/i),
      "DELETE",
    );
    await user.click(screen.getByRole("button", { name: "Delete account" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("network down");
    });
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteAccountDialog open onClose={onClose} onConfirm={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
