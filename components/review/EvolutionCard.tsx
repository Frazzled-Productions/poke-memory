import type { PokemonFact } from "@/lib/pokemon/facts";
import { EvolutionCardLayout } from "@/components/review/EvolutionCardLayout";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";

type Props = {
  /**
   * `"evolution"`: asks "What does {preEvo} evolve into?" — hides the post-evo
   * side until revealed.
   *
   * `"reverse-evolution"`: asks "Which Pokémon evolves into {postEvo}?" —
   * hides the pre-evo side until revealed.
   */
  direction: "evolution" | "reverse-evolution";
  preEvoSpriteUrl: string;
  preEvoName: string;
  postEvoName: string;
  postEvoSpriteUrl: string;
  triggerPhrase: string | null;
  revealed: boolean;
  fact?: PokemonFact | null;
  preEvoId?: number | null;
  postEvoId?: number | null;
};

/**
 * Direction-discriminated evolution card.
 *
 * Replaces the former `EvolutionCard` / `ReverseEvolutionCard` pair (#1007).
 * Both directions delegate to `EvolutionCardLayout`; the only differences are
 * the prompt sentence, the badge direction, and which side of the arrow is
 * hidden before reveal.
 *
 * `preEvoId` and `postEvoId` are threaded through to `EvolutionCardLayout` so
 * it can resolve locale-aware names at render time (#1260).
 */
export function EvolutionCard({
  direction,
  preEvoSpriteUrl,
  preEvoName,
  postEvoName,
  postEvoSpriteUrl,
  triggerPhrase,
  revealed,
  fact,
  preEvoId,
  postEvoId,
}: Props) {
  if (direction === "reverse-evolution") {
    const prompt = (
      <>
        Which Pokémon evolves into <span className="capitalize">{postEvoName}</span>
        <NameTtsButton name={postEvoName} id={postEvoId} size="inline" />
        {triggerPhrase ? <> {triggerPhrase}</> : null}?
      </>
    );

    return (
      <EvolutionCardLayout
        direction="reverse-evolution"
        prompt={prompt}
        hiddenSide="pre"
        preEvoSpriteUrl={preEvoSpriteUrl}
        preEvoName={preEvoName}
        preEvoId={preEvoId}
        postEvoSpriteUrl={postEvoSpriteUrl}
        postEvoName={postEvoName}
        postEvoId={postEvoId}
        answerName={preEvoName}
        answerId={preEvoId}
        revealed={revealed}
        fact={fact}
      />
    );
  }

  const prompt = (
    <>
      What does <span className="capitalize">{preEvoName}</span>
      <NameTtsButton name={preEvoName} id={preEvoId} size="inline" />{" "}
      evolve into{triggerPhrase ? <> {triggerPhrase}</> : null}?
    </>
  );

  return (
    <EvolutionCardLayout
      direction="evolution"
      prompt={prompt}
      hiddenSide="post"
      preEvoSpriteUrl={preEvoSpriteUrl}
      preEvoName={preEvoName}
      preEvoId={preEvoId}
      postEvoSpriteUrl={postEvoSpriteUrl}
      postEvoName={postEvoName}
      postEvoId={postEvoId}
      answerName={postEvoName}
      answerId={postEvoId}
      revealed={revealed}
      fact={fact}
    />
  );
}
