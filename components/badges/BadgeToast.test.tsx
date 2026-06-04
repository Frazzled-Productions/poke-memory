import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, act, fireEvent } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";
import { BadgeToast } from "./BadgeToast";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BadgeToast", () => {
  it("renders the badge name and description", () => {
    renderWithIntl(
      <BadgeToast
        badgeName="Cascade Badge"
        badgeDescription="You've mastered Misty's roster."
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Cascade Badge")).toBeInTheDocument();
    expect(
      screen.getByText("You've mastered Misty's roster."),
    ).toBeInTheDocument();
    expect(screen.getByText("Badge earned")).toBeInTheDocument();
  });

  it("auto-dismisses after the timeout", () => {
    const onDismiss = vi.fn();
    renderWithIntl(
      <BadgeToast
        badgeName="Cascade Badge"
        badgeDescription="x"
        onDismiss={onDismiss}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on user click", () => {
    const onDismiss = vi.fn();
    renderWithIntl(
      <BadgeToast
        badgeName="Cascade Badge"
        badgeDescription="x"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Dismiss new badge/ }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has role=status for screen-reader announcement", () => {
    const { container } = renderWithIntl(
      <BadgeToast
        badgeName="Cascade Badge"
        badgeDescription="x"
        onDismiss={() => {}}
      />,
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("dismiss button aria-label is localised in Japanese", () => {
    renderJa(
      <BadgeToast
        badgeName="Cascade Badge"
        badgeDescription="x"
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "新しいバッジを閉じる: Cascade Badge" }),
    ).toBeInTheDocument();
  });
});
