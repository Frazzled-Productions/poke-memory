import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ReverseEvolutionCard } from "@/components/review/ReverseEvolutionCard";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const PRE_SPRITE = "https://example.com/eevee.png";
const POST_SPRITE = "https://example.com/jolteon.png";

describe("ReverseEvolutionCard", () => {
  it("shows the post-evolution sprite as prompt and ??? before reveal", () => {
    render(
      <ReverseEvolutionCard
        preEvoName="eevee"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={false}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", POST_SPRITE);
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.queryByAltText("eevee")).not.toBeInTheDocument();
  });

  it("shows the pre-evolution sprite + name after reveal (the answer)", () => {
    render(
      <ReverseEvolutionCard
        preEvoName="eevee"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={true}
      />,
    );

    const answerImg = screen.getByAltText("eevee");
    expect(answerImg).toBeInTheDocument();
    expect(answerImg).toHaveAttribute("src", PRE_SPRITE);
    for (const img of screen.queryAllByRole("img")) {
      expect(img).not.toHaveAttribute("src", POST_SPRITE);
    }
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("phrases the prompt as 'Which Pokémon evolves into …'", () => {
    render(
      <ReverseEvolutionCard
        preEvoName="eevee"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={false}
      />,
    );

    expect(screen.getByText(/Which Pokémon evolves into/)).toBeInTheDocument();
    expect(screen.getByText(/if you use a Thunder Stone/)).toBeInTheDocument();
  });

  it("falls back to the bare prompt when triggerPhrase is null", () => {
    render(
      <ReverseEvolutionCard
        preEvoName="kadabra"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="alakazam"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase={null}
        revealed={false}
      />,
    );

    expect(screen.getByText(/evolves into.*\?/)).toBeInTheDocument();
  });

  it("shows fact label + value after reveal", () => {
    render(
      <ReverseEvolutionCard
        preEvoName="eevee"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={true}
        fact={{ label: "Type", value: "Normal" }}
      />,
    );

    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });
});
