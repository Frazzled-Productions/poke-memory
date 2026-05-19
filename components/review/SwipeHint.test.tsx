import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { SwipeHint } from "./SwipeHint";
import type { SwipeState } from "@/components/review/useSwipeGrade";

const INACTIVE: SwipeState = { active: false };

function makeActive(
  direction: NonNullable<Extract<SwipeState, { active: true }>["direction"]>,
  committed: boolean,
): SwipeState {
  return {
    active: true,
    direction,
    committed,
    offsetX: 0,
    offsetY: 0,
  };
}

describe("SwipeHint", () => {
  it("renders nothing when swipe is inactive", () => {
    const { container } = render(<SwipeHint swipeState={INACTIVE} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when direction is null", () => {
    const state: SwipeState = {
      active: true,
      direction: null,
      committed: false,
      offsetX: 0,
      offsetY: 0,
    };
    const { container } = render(<SwipeHint swipeState={state} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Good' for a right swipe", () => {
    render(<SwipeHint swipeState={makeActive("right", false)} />);
    expect(screen.getByText("Good")).toBeDefined();
  });

  it("shows 'Again' for a left swipe", () => {
    render(<SwipeHint swipeState={makeActive("left", false)} />);
    expect(screen.getByText("Again")).toBeDefined();
  });

  it("shows 'Easy' for an up swipe", () => {
    render(<SwipeHint swipeState={makeActive("up", false)} />);
    expect(screen.getByText("Easy")).toBeDefined();
  });

  it("shows 'Hard' for a down swipe", () => {
    render(<SwipeHint swipeState={makeActive("down", false)} />);
    expect(screen.getByText("Hard")).toBeDefined();
  });

  it("is aria-hidden so assistive tech ignores it", () => {
    const { container } = render(
      <SwipeHint swipeState={makeActive("right", false)} />,
    );
    const overlay = container.querySelector("[aria-hidden='true']");
    expect(overlay).not.toBeNull();
  });

  it("applies higher opacity class when committed", () => {
    const { container } = render(
      <SwipeHint swipeState={makeActive("right", true)} />,
    );
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain("opacity-90");
  });

  it("applies lower opacity class when not committed", () => {
    const { container } = render(
      <SwipeHint swipeState={makeActive("right", false)} />,
    );
    const overlay = container.firstChild as HTMLElement;
    expect(overlay.className).toContain("opacity-40");
  });

  it("shows the arrow character for each direction", () => {
    const arrows = [
      { direction: "right" as const, arrow: "→" },
      { direction: "left" as const, arrow: "←" },
      { direction: "up" as const, arrow: "↑" },
      { direction: "down" as const, arrow: "↓" },
    ];
    for (const { direction, arrow } of arrows) {
      const { container, unmount } = render(
        <SwipeHint swipeState={makeActive(direction, false)} />,
      );
      expect(container.textContent).toContain(arrow);
      unmount();
    }
  });

  it("uses the correct colour class for each direction", () => {
    const colours: Record<string, string> = {
      right: "bg-emerald-600",
      left: "bg-red-500",
      up: "bg-sky-500",
      down: "bg-amber-500",
    };
    for (const [direction, colour] of Object.entries(colours)) {
      const { container, unmount } = render(
        <SwipeHint
          swipeState={makeActive(direction as "right" | "left" | "up" | "down", false)}
        />,
      );
      const badge = container.querySelector("span > span")?.parentElement;
      // Look for the colour class anywhere in the rendered HTML.
      expect(container.innerHTML).toContain(colour);
      unmount();
    }
  });
});
