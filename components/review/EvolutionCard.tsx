"use client";

import type { PokemonFact } from "@/lib/pokemon/facts";
import { EvolutionCardLayout } from "@/components/review/EvolutionCardLayout";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";
import { RandomEvolutionNote } from "@/components/review/RandomEvolutionNote";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { RANDOM_BRANCH_PRE_EVO_IDS } from "@/lib/pokemon/disambiguateTrigger";

type Props = {
  /**
   * `"evolution"`: asks "What does {preEvo} evolve into?" - hides the post-evo
   * side until revealed.
   *
   * `"reverse-evolution"`: asks "Which Pokémon evolves into {postEvo}?" - 
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
 * it can resolve locale-aware names at render time. The question-side name
 * shown in the prompt sentence (e.g. "What does X evolve into?") is also
 * resolved here via the same hook so it updates on `pokemonNameLocale` change
 * without a session rebuild (#1260).
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
  // Resolve both sides so the question-side prompt and any downstream
  // assertion use the locale-aware name. The layout resolves them again
  // internally - the duplicate call is cheap (memoised by ID).
  const { name: resolvedPreEvoName } = useLocalePokemonName(
    preEvoId ?? undefined,
    preEvoName,
  );
  const { name: resolvedPostEvoName } = useLocalePokemonName(
    postEvoId ?? undefined,
    postEvoName,
  );

  if (direction === "reverse-evolution") {
    const prompt = (
      <>
        Which Pokémon evolves into <span className="capitalize">{resolvedPostEvoName}</span>
        <NameTtsButton name={resolvedPostEvoName} id={postEvoId} size="inline" />
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
      What does <span className="capitalize">{resolvedPreEvoName}</span>
      <NameTtsButton name={resolvedPreEvoName} id={preEvoId} size="inline" />{" "}
      evolve into{triggerPhrase ? <> {triggerPhrase}</> : null}?
    </>
  );

  // Some pre-evolutions (currently only Wurmple) have sibling branches chosen
  // by hidden in-game randomness rather than any encodable condition - both
  // forward cards legitimately share this prompt, so a caption explains the
  // ambiguity instead of the card guessing at one answer (#1932). Only the
  // forward direction needs this: the reverse card names a unique target.
  const randomEvolutionNote =
    preEvoId != null && RANDOM_BRANCH_PRE_EVO_IDS.has(preEvoId) ? (
      <RandomEvolutionNote preEvoId={preEvoId} preEvoName={preEvoName} />
    ) : null;

  return (
    <EvolutionCardLayout
      direction="evolution"
      prompt={prompt}
      note={randomEvolutionNote}
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
