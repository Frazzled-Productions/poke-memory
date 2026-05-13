import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EvolutionCard } from "@/components/review/EvolutionCard";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const PRE_SPRITE = "https://example.com/charmander.png";
const POST_SPRITE = "https://example.com/charmeleon.png";

describe("EvolutionCard", () => {
  it("shows the pre-evolution sprite and ??? before reveal", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={false}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", PRE_SPRITE);
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.queryByAltText("charmeleon")).not.toBeInTheDocument();
  });

  it("shows the post-evolution sprite after reveal", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={true}
      />,
    );

    const answerImg = screen.getByAltText("charmeleon");
    expect(answerImg).toBeInTheDocument();
    expect(answerImg).toHaveAttribute("src", POST_SPRITE);
    // Question sprite should no longer be shown.
    for (const img of screen.queryAllByRole("img")) {
      expect(img).not.toHaveAttribute("src", PRE_SPRITE);
    }
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("renders the answer sprite at 320px (single-target shape only)", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={true}
      />,
    );

    const answerImg = screen.getByAltText("charmeleon");
    expect(answerImg).toHaveAttribute("width", "320");
    expect(answerImg).toHaveAttribute("height", "320");
  });

  it("interpolates the trigger phrase into the prompt", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="eevee"
        postEvoName="jolteon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="using a Thunder Stone"
        revealed={false}
      />,
    );

    // The prompt is split across multiple inline spans, so query by partial
    // text matches that survive the markup.
    expect(screen.getByText(/evolve into/)).toBeInTheDocument();
    expect(screen.getByText(/using a Thunder Stone/)).toBeInTheDocument();
  });

  it("falls back to the bare prompt when triggerPhrase is null", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="kadabra"
        postEvoName="alakazam"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase={null}
        revealed={false}
      />,
    );

    // The prompt should still ask "What does kadabra evolve into?" with no
    // extra trigger fragment between "into" and "?".
    expect(screen.getByText(/evolve into\?/)).toBeInTheDocument();
  });

  it("shows fact label and value when fact prop is provided", () => {
    const fact = { label: "Type", value: "Fire" };

    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
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
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={true}
      />,
    );

    expect(screen.queryByText("Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Fire")).not.toBeInTheDocument();
  });
});
