import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EvolutionCard } from "@/components/review/EvolutionCard";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const QUESTION_SPRITE = "https://example.com/charmander.png";
const EVOLVES_INTO = [
  { name: "charmeleon", spriteUrl: "https://example.com/charmeleon.png" },
];

describe("EvolutionCard", () => {
  it("shows questioned Pokémon sprite and ??? before reveal", () => {
    render(
      <EvolutionCard
        spriteUrl={QUESTION_SPRITE}
        name="charmander"
        evolvesInto={EVOLVES_INTO}
        revealed={false}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", QUESTION_SPRITE);
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.queryByAltText("charmeleon")).not.toBeInTheDocument();
  });

  it("shows answer sprite(s) instead of question sprite after reveal", () => {
    render(
      <EvolutionCard
        spriteUrl={QUESTION_SPRITE}
        name="charmander"
        evolvesInto={EVOLVES_INTO}
        revealed={true}
      />,
    );

    const answerImg = screen.getByAltText("charmeleon");
    expect(answerImg).toBeInTheDocument();
    expect(answerImg).toHaveAttribute("src", "https://example.com/charmeleon.png");
    // Question sprite should no longer be shown
    expect(screen.queryByRole("img", { hidden: false })).not.toHaveAttribute(
      "src",
      QUESTION_SPRITE,
    );
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("renders all answer sprites for branching evolutions", () => {
    const eeveeEvolutions = [
      { name: "vaporeon", spriteUrl: "https://example.com/vaporeon.png" },
      { name: "jolteon", spriteUrl: "https://example.com/jolteon.png" },
      { name: "flareon", spriteUrl: "https://example.com/flareon.png" },
    ];

    render(
      <EvolutionCard
        spriteUrl={QUESTION_SPRITE}
        name="eevee"
        evolvesInto={eeveeEvolutions}
        revealed={true}
      />,
    );

    for (const evo of eeveeEvolutions) {
      expect(screen.getByAltText(evo.name)).toBeInTheDocument();
    }
    // All three answer sprites are shown
    expect(screen.getAllByRole("img")).toHaveLength(eeveeEvolutions.length);
  });
});
