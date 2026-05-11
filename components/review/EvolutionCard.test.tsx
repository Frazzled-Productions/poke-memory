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
    for (const img of screen.queryAllByRole("img")) {
      expect(img).not.toHaveAttribute("src", QUESTION_SPRITE);
    }
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("renders single-evolution sprite at 320px after reveal", () => {
    render(
      <EvolutionCard
        spriteUrl={QUESTION_SPRITE}
        name="charmander"
        evolvesInto={EVOLVES_INTO}
        revealed={true}
      />,
    );

    const answerImg = screen.getByAltText("charmeleon");
    expect(answerImg).toHaveAttribute("width", "320");
    expect(answerImg).toHaveAttribute("height", "320");
  });

  it("renders branching-evolution sprites at 96px after reveal", () => {
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
      const img = screen.getByAltText(evo.name);
      expect(img).toHaveAttribute("width", "96");
      expect(img).toHaveAttribute("height", "96");
    }
  });

  it("shows fact label and value when fact prop is provided", () => {
    const fact = { label: "Type", value: "Fire" };

    render(
      <EvolutionCard
        spriteUrl={QUESTION_SPRITE}
        name="charmander"
        evolvesInto={EVOLVES_INTO}
        revealed={true}
        fact={fact}
      />,
    );

    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Fire")).toBeInTheDocument();
  });

  it("does not show fact when fact prop is omitted", () => {
    render(
      <EvolutionCard
        spriteUrl={QUESTION_SPRITE}
        name="charmander"
        evolvesInto={EVOLVES_INTO}
        revealed={true}
      />,
    );

    // No unexpected fact content rendered
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
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
