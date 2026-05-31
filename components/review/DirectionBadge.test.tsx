import { describe, it, expect } from "vitest";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
import { DirectionBadge, type CardDirection } from "@/components/review/DirectionBadge";

describe("DirectionBadge — English labels", () => {
  const cases: Array<[CardDirection, string]> = [
    ["name", "Name this Pokémon"],
    ["evolution", "Evolution"],
    ["reverse-evolution", "Pre-evolution"],
    ["reverse", "Pick the sprite"],
    ["cry", "Name from cry"],
  ];

  for (const [direction, label] of cases) {
    it(`renders the ${direction} badge with its label`, () => {
      renderWithIntl(<DirectionBadge direction={direction} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-label",
        `Card type: ${label}`,
      );
    });
  }
});

describe("DirectionBadge — Japanese labels", () => {
  it("renders the name direction in Japanese", () => {
    renderJa(<DirectionBadge direction="name" />);
    expect(screen.getByText("この Pokémon の名前は？")).toBeInTheDocument();
  });

  it("renders the evolution direction in Japanese", () => {
    renderJa(<DirectionBadge direction="evolution" />);
    expect(screen.getByText("進化")).toBeInTheDocument();
  });

  it("renders the reverse-evolution direction in Japanese", () => {
    renderJa(<DirectionBadge direction="reverse-evolution" />);
    expect(screen.getByText("前の進化")).toBeInTheDocument();
  });
});
