import type { PokemonFact } from "@/lib/pokemon/facts";
import { EvolutionCardLayout } from "@/components/review/EvolutionCardLayout";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";

type Props = {
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

export function EvolutionCard({
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
      postEvoSpriteUrl={postEvoSpriteUrl}
      postEvoName={postEvoName}
      answerName={postEvoName}
      answerId={postEvoId}
      revealed={revealed}
      fact={fact}
    />
  );
}
