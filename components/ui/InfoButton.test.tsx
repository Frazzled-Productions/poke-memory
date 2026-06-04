/**
 * Component tests for InfoButton.
 *
 * Verifies WAI-ARIA disclosure-button pattern:
 *   - Toggles panel open/closed on click.
 *   - aria-expanded reflects open/closed state.
 *   - Escape closes the panel.
 *   - Outside-click closes the panel.
 *   - Panel content is present when open and absent when closed.
 */

import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfoButton } from "@/components/ui/InfoButton";

const PANEL_CONTENT = <p>Explanation text here.</p>;
const ARIA_LABEL = "About this feature";
const PANEL_ID = "test-info-panel";

function renderButton() {
  return render(
    <InfoButton
      ariaLabel={ARIA_LABEL}
      panelContent={PANEL_CONTENT}
      panelId={PANEL_ID}
    />,
  );
}

describe("InfoButton", () => {
  it("renders a button with the correct aria-label", () => {
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    expect(btn).toBeInTheDocument();
  });

  it("starts with aria-expanded=false and panel not visible", () => {
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Explanation text here.")).not.toBeInTheDocument();
  });

  it("opens the panel on click and sets aria-expanded=true", async () => {
    const user = userEvent.setup();
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Explanation text here.")).toBeInTheDocument();
  });

  it("closes the panel on second click and sets aria-expanded=false", async () => {
    const user = userEvent.setup();
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    await user.click(btn);
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Explanation text here.")).not.toBeInTheDocument();
  });

  it("button has aria-controls pointing to the panel id", () => {
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    expect(btn).toHaveAttribute("aria-controls", PANEL_ID);
  });

  it("the panel has the correct id when open", async () => {
    const user = userEvent.setup();
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    await user.click(btn);
    const panel = document.getElementById(PANEL_ID);
    expect(panel).not.toBeNull();
    expect(panel).toBeInTheDocument();
  });

  it("closes the panel on Escape key", async () => {
    const user = userEvent.setup();
    renderButton();
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Explanation text here.")).not.toBeInTheDocument();
  });

  it("closes the panel on outside click", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <InfoButton
          ariaLabel={ARIA_LABEL}
          panelContent={PANEL_CONTENT}
          panelId={PANEL_ID}
        />
        <div data-testid="outside">Outside element</div>
      </div>,
    );
    const btn = screen.getByRole("button", { name: ARIA_LABEL });
    await user.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");

    // Click outside the InfoButton container.
    fireEvent.mouseDown(container.querySelector("[data-testid='outside']")!);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Explanation text here.")).not.toBeInTheDocument();
  });

  it("panel content is present when open", async () => {
    const user = userEvent.setup();
    renderButton();
    await user.click(screen.getByRole("button", { name: ARIA_LABEL }));
    expect(screen.getByText("Explanation text here.")).toBeInTheDocument();
  });
});
