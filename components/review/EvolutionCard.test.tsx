import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EvolutionCard } from "@/components/review/EvolutionCard";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("@/lib/audio/tts", () => ({ speakName: vi.fn() }));

const PRE_SPRITE = "https://example.com/charmander.png";
const POST_SPRITE = "https://example.com/charmeleon.png";

describe("EvolutionCard", () => {
  it("shows the pre-evolution sprite plus a ? placeholder before reveal", () => {
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

    expect(screen.getByAltText("charmander")).toHaveAttribute("src", PRE_SPRITE);
    expect(screen.queryByAltText("charmeleon")).not.toBeInTheDocument();
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("shows the post-evolution sprite after reveal alongside the pre-evolution", () => {
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

    expect(screen.getByAltText("charmander")).toHaveAttribute("src", PRE_SPRITE);
    expect(screen.getByAltText("charmeleon")).toHaveAttribute("src", POST_SPRITE);
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("renders sprites at intrinsic 320px", () => {
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

    expect(screen.getByText(/evolve into\?/)).toBeInTheDocument();
  });

  it("shows the direction badge", () => {
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

    expect(screen.getByText("Evolution")).toBeInTheDocument();
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

  it("renders an inline TTS button for the pre-evo name in the prompt", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={false}
        preEvoId={4}
      />,
    );
    expect(screen.getByRole("button", { name: "Hear charmander" })).toBeInTheDocument();
  });

  it("renders a reveal TTS button for the post-evo name after reveal", () => {
    render(
      <EvolutionCard
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={true}
        postEvoId={5}
      />,
    );
    expect(screen.getByRole("button", { name: "Hear charmeleon" })).toBeInTheDocument();
  });
});
