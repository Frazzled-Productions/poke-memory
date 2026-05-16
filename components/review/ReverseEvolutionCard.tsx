import type { PokemonFact } from "@/lib/pokemon/facts";
import { EvolutionCardLayout } from "@/components/review/EvolutionCardLayout";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";

type Props = {
  preEvoName: string;
  preEvoSpriteUrl: string;
  postEvoName: string;
  postEvoSpriteUrl: string;
  triggerPhrase: string | null;
  revealed: boolean;
  fact?: PokemonFact | null;
  preEvoId?: number | null;
  postEvoId?: number | null;
};

/**
 * Reverse-direction evolution card (#343). Thin wrapper around
 * `EvolutionCardLayout` with `hiddenSide="pre"`:
 *   - Prompt: "Which Pokémon evolves into {postEvoName} {triggerPhrase}?"
 *   - Pre-reveal: "?" placeholder → arrow → postEvo sprite.
 *   - Post-reveal: preEvo sprite (answer) → arrow → postEvo sprite.
 */
export function ReverseEvolutionCard({
  preEvoName,
  preEvoSpriteUrl,
  postEvoName,
  postEvoSpriteUrl,
  triggerPhrase,
  revealed,
  fact,
  preEvoId,
  postEvoId,
}: Props) {
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
      postEvoSpriteUrl={postEvoSpriteUrl}
      postEvoName={postEvoName}
      answerName={preEvoName}
      answerId={preEvoId}
      revealed={revealed}
      fact={fact}
    />
  );
}
