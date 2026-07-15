import { describe, it, expect, vi } from "vitest";
import { renderWithIntl as render, screen } from "@/components/test-utils/renderWithIntl";
import { EvolutionCard } from "@/components/review/EvolutionCard";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

vi.mock("@/lib/audio/tts", () => ({ speakName: vi.fn() }));

// Return the English name synchronously so tests are deterministic and do not
// depend on localStorage or the locale sidecar being loaded.
vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_id: number | undefined, englishName: string) => ({
    name: englishName,
    transliteration: null,
  }),
}));

const PRE_SPRITE = "https://example.com/charmander.png";
const POST_SPRITE = "https://example.com/charmeleon.png";

// ---------------------------------------------------------------------------
// direction="evolution" (forward - "What does X evolve into?")
// ---------------------------------------------------------------------------

describe('EvolutionCard direction="evolution"', () => {
  it("shows the pre-evolution sprite plus a ? placeholder before reveal", () => {
    render(
      <EvolutionCard
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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
        direction="evolution"
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

// ---------------------------------------------------------------------------
// direction="reverse-evolution" (reverse - "Which Pokémon evolves into X?")
// Migrated from ReverseEvolutionCard.test.tsx (#1007).
// ---------------------------------------------------------------------------

const REV_PRE_SPRITE = "https://example.com/eevee.png";
const REV_POST_SPRITE = "https://example.com/jolteon.png";

describe('EvolutionCard direction="reverse-evolution"', () => {
  it("shows the post-evolution sprite plus a ? placeholder before reveal", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={false}
      />,
    );

    expect(screen.getByAltText("jolteon")).toHaveAttribute("src", REV_POST_SPRITE);
    expect(screen.queryByAltText("eevee")).not.toBeInTheDocument();
    expect(screen.getByText("???")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("shows the pre-evolution sprite (answer) alongside the post-evolution after reveal", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={true}
      />,
    );

    expect(screen.getByAltText("eevee")).toHaveAttribute("src", REV_PRE_SPRITE);
    expect(screen.getByAltText("jolteon")).toHaveAttribute("src", REV_POST_SPRITE);
    expect(screen.queryByText("???")).not.toBeInTheDocument();
  });

  it("shows the direction badge", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={false}
      />,
    );

    expect(screen.getByText("Pre-evolution")).toBeInTheDocument();
  });

  it("phrases the prompt as 'Which Pokémon evolves into …'", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={false}
      />,
    );

    expect(screen.getByText(/Which Pokémon evolves into/)).toBeInTheDocument();
    expect(screen.getByText(/if you use a Thunder Stone/)).toBeInTheDocument();
  });

  it("falls back to the bare prompt when triggerPhrase is null", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="kadabra"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="alakazam"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase={null}
        revealed={false}
      />,
    );

    expect(screen.getByText(/evolves into.*\?/)).toBeInTheDocument();
  });

  it("shows fact label + value after reveal", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={true}
        fact={{ label: "Type", value: "Normal" }}
      />,
    );

    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("renders an inline TTS button for the post-evo name in the prompt", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={false}
        postEvoId={135}
      />,
    );
    expect(screen.getByRole("button", { name: "Hear jolteon" })).toBeInTheDocument();
  });

  it("renders a reveal TTS button for the pre-evo name (answer) after reveal", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="eevee"
        preEvoSpriteUrl={REV_PRE_SPRITE}
        postEvoName="jolteon"
        postEvoSpriteUrl={REV_POST_SPRITE}
        triggerPhrase="if you use a Thunder Stone"
        revealed={true}
        preEvoId={133}
      />,
    );
    expect(screen.getByRole("button", { name: "Hear eevee" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale-aware question prompt (#1260 followup)
// ---------------------------------------------------------------------------

describe("EvolutionCard - question-side name uses useLocalePokemonName", () => {
  it("forward direction: prompt renders the locale-resolved pre-evo name", async () => {
    vi.resetModules();
    vi.doMock("@/lib/i18n/useLocalePokemonName", () => ({
      useLocalePokemonName: (id: number | undefined, _english: string) => ({
        name: id === 4 ? "ヒトカゲ" : "MISS",
        transliteration: null,
      }),
    }));
    const { EvolutionCard: LocaleEvolutionCard } = await import(
      "@/components/review/EvolutionCard"
    );
    render(
      <LocaleEvolutionCard
        direction="evolution"
        preEvoName="charmander"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase={null}
        revealed={false}
        preEvoId={4}
        postEvoId={5}
      />,
    );
    // Question prompt should use the locale-resolved name, not "charmander".
    expect(screen.getByText("ヒトカゲ")).toBeInTheDocument();
    expect(screen.queryByText("charmander")).not.toBeInTheDocument();
  });

  it("reverse direction: prompt renders the locale-resolved post-evo name", async () => {
    vi.resetModules();
    vi.doMock("@/lib/i18n/useLocalePokemonName", () => ({
      useLocalePokemonName: (id: number | undefined, _english: string) => ({
        name: id === 5 ? "リザード" : "MISS",
        transliteration: null,
      }),
    }));
    const { EvolutionCard: LocaleEvolutionCard } = await import(
      "@/components/review/EvolutionCard"
    );
    render(
      <LocaleEvolutionCard
        direction="reverse-evolution"
        preEvoName="charmander"
        preEvoSpriteUrl={PRE_SPRITE}
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase={null}
        revealed={false}
        preEvoId={4}
        postEvoId={5}
      />,
    );
    expect(screen.getByText("リザード")).toBeInTheDocument();
    expect(screen.queryByText("charmeleon")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Random-evolution note gating (#1932)
//
// Wurmple's two forward evolution edges (-> Silcoon / -> Cascoon) share an
// identical trigger phrase because the branch is chosen by hidden in-game
// randomness - there is no honest way to disambiguate the prompt. Rather than
// guessing at one answer, the forward card renders a caption explaining the
// ambiguity. It must render ONLY on the forward direction, and ONLY for
// pre-evos with an entry in RANDOM_BRANCH_NOTE_SPECIES (currently Wurmple,
// species id 265).
// ---------------------------------------------------------------------------

const WURMPLE_SPRITE = "https://example.com/wurmple.png";
const SILCOON_SPRITE = "https://example.com/silcoon.png";

describe("EvolutionCard - random-evolution note (#1932)", () => {
  it("renders the random-evolution note on Wurmple's forward card", () => {
    render(
      <EvolutionCard
        direction="evolution"
        preEvoSpriteUrl={WURMPLE_SPRITE}
        preEvoName="Wurmple"
        preEvoId={265}
        postEvoName="Silcoon"
        postEvoSpriteUrl={SILCOON_SPRITE}
        postEvoId={266}
        triggerPhrase={null}
        revealed={false}
      />,
    );

    expect(
      screen.getByText(/evolution is random: it can become/),
    ).toBeInTheDocument();
    expect(screen.getByText("Silcoon")).toBeInTheDocument();
    expect(screen.getByText("Cascoon")).toBeInTheDocument();
  });

  it("does not render the note for a non-random forward card (Charmander)", () => {
    render(
      <EvolutionCard
        direction="evolution"
        preEvoSpriteUrl={PRE_SPRITE}
        preEvoName="charmander"
        preEvoId={4}
        postEvoName="charmeleon"
        postEvoSpriteUrl={POST_SPRITE}
        triggerPhrase="at level 16"
        revealed={false}
      />,
    );

    expect(
      screen.queryByText(/evolution is random/),
    ).not.toBeInTheDocument();
  });

  it("does not render the note on Wurmple's reverse-evolution card", () => {
    render(
      <EvolutionCard
        direction="reverse-evolution"
        preEvoName="Wurmple"
        preEvoId={265}
        preEvoSpriteUrl={WURMPLE_SPRITE}
        postEvoName="Silcoon"
        postEvoId={266}
        postEvoSpriteUrl={SILCOON_SPRITE}
        triggerPhrase={null}
        revealed={false}
      />,
    );

    expect(
      screen.queryByText(/evolution is random/),
    ).not.toBeInTheDocument();
  });
});
