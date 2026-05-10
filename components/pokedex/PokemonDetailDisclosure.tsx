"use client";

import Link from "next/link";
import { useCardClass } from "@/lib/review/useCardClass";
import type { SeedPokemon, EvolutionNode } from "@/lib/pokemon/seed";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { getPokemonFacts } from "@/lib/pokemon/facts";
import { TYPE_COLORS } from "@/lib/pokemon/types";
import type { CardClassOrPending } from "@/lib/review/useCardClass";

function zeroPad(id: number): string {
  return String(id).padStart(3, "0");
}

const STAT_LABELS: Record<string, string> = {
  hp:             "HP",
  attack:         "Attack",
  defense:        "Defense",
  specialAttack:  "Sp. Atk",
  specialDefense: "Sp. Def",
  speed:          "Speed",
};

const STAT_ORDER = ["hp", "attack", "defense", "specialAttack", "specialDefense", "speed"] as const;
type StatKey = (typeof STAT_ORDER)[number];

function statBarColor(value: number): string {
  if (value >= 100) return "bg-green-500";
  if (value >= 50)  return "bg-amber-400";
  return "bg-red-500";
}

const SPRITE_BY_ID: Record<number, string> = Object.fromEntries(
  SEED_POKEMON.map((p) => [p.id, p.spriteUrl])
);

function EvolutionChainNode({ node }: { node: EvolutionNode }) {
  const nodeSprite = SPRITE_BY_ID[node.speciesId];
  const nodeClass: CardClassOrPending = useCardClass(node.speciesId);
  const nodePending = nodeClass === "pending";
  const nodeLocked = nodeClass === "locked";
  const nodeLearning = nodeClass === "learning";

  if (nodePending) {
    return (
      <div className="flex flex-col items-center gap-0.5 rounded-lg p-1.5 animate-pulse">
        <div className="h-10 w-10 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-3 w-10 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
    );
  }

  return (
    <Link
      href={"/pokedex/" + node.speciesId}
      className="flex flex-col items-center gap-0.5 rounded-lg p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
    >
      {nodeSprite ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={nodeSprite}
          alt={nodeLocked ? `#${zeroPad(node.speciesId)} (locked)` : node.name}
          width={40}
          height={40}
          className={[
            "h-10 w-10 object-contain",
            nodeLocked ? "brightness-0" : nodeLearning ? "grayscale opacity-60" : "",
          ].join(" ")}
        />
      ) : (
        <div
          className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-700"
          aria-hidden="true"
        />
      )}
      <span className="text-xs text-center text-zinc-600 dark:text-zinc-300 leading-tight max-w-[4rem]">
        {nodeLocked ? "???" : node.name}
      </span>
    </Link>
  );
}

function buildStages(chain: EvolutionNode[]): EvolutionNode[][] {
  if (chain.length === 0) return [];
  const stages: EvolutionNode[][] = [];
  let remaining = [...chain];
  const stage1 = remaining.filter((n) => n.evolvesFromId === null);
  if (stage1.length === 0) return [];
  stages.push(stage1);
  remaining = remaining.filter((n) => n.evolvesFromId !== null);
  while (remaining.length > 0) {
    const parentIds = new Set(stages[stages.length - 1].map((n) => n.speciesId));
    const next = remaining.filter((n) => parentIds.has(n.evolvesFromId!));
    if (next.length === 0) break;
    stages.push(next);
    const nextIds = new Set(next.map((n) => n.speciesId));
    remaining = remaining.filter((n) => !nextIds.has(n.speciesId));
  }
  return stages;
}

export function PokemonDetailDisclosure({ pokemon }: { pokemon: SeedPokemon }) {
  const { id, name, spriteUrl, types, stats, flavorText, evolutionChain } = pokemon;
  const cardClass = useCardClass(id);
  const isPending = cardClass === "pending";
  const isLocked = cardClass === "locked";
  const isMasteredCard = cardClass === "mastered";
  const isLearning = cardClass === "learning";

  const facts = getPokemonFacts(pokemon);
  const stages = buildStages(evolutionChain);
  const showEvolution = stages.length > 1;

  if (isPending) {
    return (
      <div className="flex flex-col items-center gap-4 animate-pulse">
        <div className="h-4 w-12 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-48 w-48 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-8 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm font-mono text-zinc-400 dark:text-zinc-500">
          #{zeroPad(id)}
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={spriteUrl}
          alt={isLocked ? `#${zeroPad(id)} (locked)` : name}
          width={192}
          height={192}
          className={[
            "h-48 w-48 object-contain",
            isLocked ? "brightness-0" : isLearning ? "grayscale opacity-60" : "",
          ].join(" ")}
        />
        {isLocked ? (
          <h1 className="text-3xl font-bold tracking-tight text-zinc-300 dark:text-zinc-700">???</h1>
        ) : (
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{name}</h1>
        )}
        {!isLocked && (
          <div className="flex gap-2" aria-label="Types">
            {types.map((type) => {
              const colors = TYPE_COLORS[type] ?? { bg: "bg-zinc-400", text: "text-white" };
              return (
                <span
                  key={type}
                  className={[
                    "rounded-full px-3 py-0.5 text-xs font-semibold capitalize",
                    colors.bg,
                    colors.text,
                  ].join(" ")}
                >
                  {type}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {isLocked ? (
        <p className="mt-8 text-sm text-zinc-400 dark:text-zinc-500 text-center">
          Start learning this Pok&#233;mon to reveal its details.
        </p>
      ) : (
        <p className="mt-8 text-sm italic text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {flavorText}
        </p>
      )}

      {isMasteredCard && (
        <section aria-labelledby="stats-heading" className="mt-8">
          <h2
            id="stats-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500"
          >
            Base Stats
          </h2>
          <dl className="flex flex-col gap-2">
            {STAT_ORDER.map((key: StatKey) => {
              const value = stats[key];
              const pct = Math.min((value / 255) * 100, 100);
              return (
                <div
                  key={key}
                  className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3"
                >
                  <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 text-right">
                    {STAT_LABELS[key]}
                  </dt>
                  <dd className="relative h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                    <div
                      className={["absolute inset-y-0 left-0 rounded-full", statBarColor(value)].join(" ")}
                      style={{ width: pct + "%" }}
                      role="presentation"
                    />
                  </dd>
                  <span className="text-xs font-mono text-right text-zinc-600 dark:text-zinc-300">
                    {value}
                  </span>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {isMasteredCard && (
        <section aria-labelledby="facts-heading" className="mt-10">
          <h2
            id="facts-heading"
            className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500"
          >
            Facts
          </h2>
          <dl className="flex flex-col gap-2">
            {facts.map((fact, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <dt className="w-32 shrink-0 text-right text-xs font-medium text-zinc-500 dark:text-zinc-400 pt-0.5">
                  {fact.label}
                </dt>
                <dd className="text-zinc-700 dark:text-zinc-200">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {isMasteredCard && showEvolution && (
        <section aria-labelledby="evo-heading" className="mt-10">
          <h2
            id="evo-heading"
            className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500"
          >
            Evolution Chain
          </h2>
          <div className="flex flex-wrap items-start justify-center gap-2 sm:flex-nowrap">
            {stages.map((stage, stageIndex) => (
              <div key={stageIndex} className="flex items-center gap-2">
                {stageIndex > 0 && (
                  <span
                    className="text-zinc-400 dark:text-zinc-500 text-xl select-none"
                    aria-hidden="true"
                  >
                    &#8594;
                  </span>
                )}
                <div className="flex flex-col items-center gap-3">
                  {stage.map((node) => (
                    <EvolutionChainNode key={node.speciesId} node={node} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
