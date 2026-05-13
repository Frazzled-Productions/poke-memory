import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DirectionBadge, type CardDirection } from "@/components/review/DirectionBadge";

describe("DirectionBadge", () => {
  const cases: Array<[CardDirection, string]> = [
    ["name", "Name this Pokémon"],
    ["evolution", "Evolution"],
    ["reverse-evolution", "Pre-evolution"],
    ["reverse", "Pick the sprite"],
    ["cry", "Name from cry"],
  ];

  for (const [direction, label] of cases) {
    it(`renders the ${direction} badge with its label`, () => {
      render(<DirectionBadge direction={direction} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-label",
        `Card type: ${label}`,
      );
    });
  }
});
