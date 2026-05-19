/**
 * Render-parity tests for `EvolutionCardLayout`.
 *
 * These tests exercise the shared layout directly, verifying the sprite/arrow
 * row, the hidden-side logic, the reveal state, and the fact block. The
 * per-direction wrapper tests in EvolutionCard.test.tsx cover the prompt
 * sentence and badge in context.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EvolutionCardLayout } from "@/components/review/EvolutionCardLayout";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("@/lib/audio/tts", () => ({ speakName: vi.fn() }));

const PRE_SPRITE = "https://example.com/charmander.png";
const POST_SPRITE = "https://example.com/charmeleon.png";

const BASE_PROPS = {
  direction: "evolution" as const,
  prompt: <span>Test prompt</span>,
  preEvoSpriteUrl: PRE_SPRITE,
  preEvoName: "charmander",
  postEvoSpriteUrl: POST_SPRITE,
  postEvoName: "charmeleon",
  answerName: "charmeleon",
  revealed: false,
};

describe("EvolutionCardLayout — hiddenSide='post' (forward evolution)", () => {
  it("shows the pre-evo sprite and a ? placeholder before reveal", () => {
    render(<EvolutionCardLayout {...BASE_PROPS} hiddenSide="post" />);
    expect(screen.getByAltText("charmander")).toHaveAttribute("src", PRE_SPRITE);
    expect(screen.queryByAltText("charmeleon")).not.toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByText("???")).toBeInTheDocument();
  });

  it("shows both sprites after reveal", () => {
    render(<EvolutionCardLayout {...BASE_PROPS} hiddenSide="post" revealed={true} />);
    expect(screen.getByAltText("charmander")).toHaveAttribute("src", PRE_SPRITE);
    expect(screen.getByAltText("charmeleon")).toHaveAttribute("src", POST_SPRITE);
    expect(screen.queryByText("???")).not.toBeInTheDocument();
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  it("shows the answer name and TTS button after reveal", () => {
    render(<EvolutionCardLayout {...BASE_PROPS} hiddenSide="post" revealed={true} />);
    expect(screen.getByText("charmeleon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hear charmeleon" })).toBeInTheDocument();
  });
});

describe("EvolutionCardLayout — hiddenSide='pre' (reverse evolution)", () => {
  const REVERSE_PROPS = {
    ...BASE_PROPS,
    direction: "reverse-evolution" as const,
    answerName: "charmander",
    answerId: 4,
  };

  it("shows the post-evo sprite and a ? placeholder before reveal", () => {
    render(<EvolutionCardLayout {...REVERSE_PROPS} hiddenSide="pre" />);
    expect(screen.getByAltText("charmeleon")).toHaveAttribute("src", POST_SPRITE);
    expect(screen.queryByAltText("charmander")).not.toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByText("???")).toBeInTheDocument();
  });

  it("shows both sprites after reveal", () => {
    render(<EvolutionCardLayout {...REVERSE_PROPS} hiddenSide="pre" revealed={true} />);
    expect(screen.getByAltText("charmander")).toHaveAttribute("src", PRE_SPRITE);
    expect(screen.getByAltText("charmeleon")).toHaveAttribute("src", POST_SPRITE);
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("shows the answer name and TTS button after reveal", () => {
    render(<EvolutionCardLayout {...REVERSE_PROPS} hiddenSide="pre" revealed={true} />);
    expect(screen.getByText("charmander")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hear charmander" })).toBeInTheDocument();
  });
});

describe("EvolutionCardLayout — direction badge", () => {
  it('shows the Evolution badge for direction="evolution"', () => {
    render(<EvolutionCardLayout {...BASE_PROPS} hiddenSide="post" />);
    expect(screen.getByText("Evolution")).toBeInTheDocument();
  });

  it('shows the Pre-evolution badge for direction="reverse-evolution"', () => {
    render(
      <EvolutionCardLayout
        {...BASE_PROPS}
        direction="reverse-evolution"
        hiddenSide="pre"
      />,
    );
    expect(screen.getByText("Pre-evolution")).toBeInTheDocument();
  });
});

describe("EvolutionCardLayout — fact block", () => {
  it("renders fact label and value when fact is provided and revealed", () => {
    render(
      <EvolutionCardLayout
        {...BASE_PROPS}
        hiddenSide="post"
        revealed={true}
        fact={{ label: "Type", value: "Fire" }}
      />,
    );
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Fire")).toBeInTheDocument();
  });

  it("does not render the fact block when fact is omitted", () => {
    render(<EvolutionCardLayout {...BASE_PROPS} hiddenSide="post" revealed={true} />);
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  it("does not render the fact block when not yet revealed", () => {
    render(
      <EvolutionCardLayout
        {...BASE_PROPS}
        hiddenSide="post"
        revealed={false}
        fact={{ label: "Type", value: "Fire" }}
      />,
    );
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
    expect(screen.queryByText("Fire")).not.toBeInTheDocument();
  });
});

describe("EvolutionCardLayout — prompt", () => {
  it("renders the prompt node passed as a prop", () => {
    render(
      <EvolutionCardLayout
        {...BASE_PROPS}
        hiddenSide="post"
        prompt={<span>Custom test prompt</span>}
      />,
    );
    expect(screen.getByText("Custom test prompt")).toBeInTheDocument();
  });
});

describe("EvolutionCardLayout — sprites at intrinsic 320px", () => {
  it("renders both sprites at width/height 320 after reveal", () => {
    render(<EvolutionCardLayout {...BASE_PROPS} hiddenSide="post" revealed={true} />);
    expect(screen.getByAltText("charmander")).toHaveAttribute("width", "320");
    expect(screen.getByAltText("charmeleon")).toHaveAttribute("width", "320");
  });
});

