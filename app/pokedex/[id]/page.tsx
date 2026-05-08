import { notFound } from "next/navigation";
import Link from "next/link";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import type { EvolutionNode } from "@/lib/pokemon/seed";

function zeroPad(id: number): string {
  return String(id).padStart(3, "0");
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  normal:   { bg: "bg-stone-400",  text: "text-white" },
  fire:     { bg: "bg-orange-500", text: "text-white" },
  water:    { bg: "bg-blue-500",   text: "text-white" },
  electric: { bg: "bg-yellow-400", text: "text-zinc-900" },
  grass:    { bg: "bg-green-500",  text: "text-white" },
  ice:      { bg: "bg-cyan-300",   text: "text-zinc-900" },
  fighting: { bg: "bg-red-700",    text: "text-white" },
  poison:   { bg: "bg-purple-500", text: "text-white" },
  ground:   { bg: "bg-amber-600",  text: "text-white" },
  flying:   { bg: "bg-indigo-400", text: "text-white" },
  psychic:  { bg: "bg-pink-500",   text: "text-white" },
  bug:      { bg: "bg-lime-500",   text: "text-white" },
  rock:     { bg: "bg-yellow-700", text: "text-white" },
  ghost:    { bg: "bg-violet-700", text: "text-white" },
  dragon:   { bg: "bg-violet-500", text: "text-white" },
  dark:     { bg: "bg-zinc-800",   text: "text-white" },
  steel:    { bg: "bg-slate-400",  text: "text-zinc-900" },
  fairy:    { bg: "bg-pink-300",   text: "text-zinc-900" },
};

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

export default async function PokemonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);

  if (!Number.isInteger(id) || id < 1 || id > 1025) notFound();

  const pokemon = SEED_POKEMON.find((p) => p.id === id);
  if (!pokemon) notFound();

  const { name, spriteUrl, types, stats, flavorText, evolutionChain } = pokemon!;

  const stages = buildStages(evolutionChain);
  const showEvolution = stages.length > 1;

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-2xl">

        <Link
          href="/pokedex"
          className="mb-8 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400 dark:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded"
        >
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Pok&#233;dex
        </Link>

        <div className="flex flex-col items-center gap-4">
          <p className="text-sm font-mono text-zinc-400 dark:text-zinc-500">
            #{zeroPad(id)}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={spriteUrl} alt={name} width={192} height={192} className="h-48 w-48 object-contain" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{name}</h1>
          <div className="flex gap-2" aria-label="Types">
            {types.map((type) => {
              const colors = TYPE_COLORS[type] ?? { bg: "bg-zinc-400", text: "text-white" };
              return (
                <span key={type} className={["rounded-full px-3 py-0.5 text-xs font-semibold capitalize", colors.bg, colors.text].join(" ")}>
                  {type}
                </span>
              );
            })}
          </div>
        </div>

        <p className="mt-8 text-sm italic text-zinc-500 dark:text-zinc-400 leading-relaxed">{flavorText}</p>

        <section aria-labelledby="stats-heading" className="mt-8">
          <h2 id="stats-heading" className="mb-3 text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            Base Stats
          </h2>
          <dl className="flex flex-col gap-2">
            {STAT_ORDER.map((key: StatKey) => {
              const value = stats[key];
              const pct = Math.min((value / 255) * 100, 100);
              return (
                <div key={key} className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3">
                  <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400 text-right">{STAT_LABELS[key]}</dt>
                  <dd className="relative h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                    <div className={["absolute inset-y-0 left-0 rounded-full", statBarColor(value)].join(" ")} style={{ width: pct + "%" }} role="presentation" />
                  </dd>
                  <span className="text-xs font-mono text-right text-zinc-600 dark:text-zinc-300">{value}</span>
                </div>
              );
            })}
          </dl>
        </section>

        {showEvolution && (
          <section aria-labelledby="evo-heading" className="mt-10">
            <h2 id="evo-heading" className="mb-4 text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              Evolution Chain
            </h2>
            <div className="flex flex-wrap items-start justify-center gap-2 sm:flex-nowrap">
              {stages.map((stage, stageIndex) => (
                <div key={stageIndex} className="flex items-center gap-2">
                  {stageIndex > 0 && (
                    <span className="text-zinc-400 dark:text-zinc-500 text-xl select-none" aria-hidden="true">&#8594;</span>
                  )}
                  <div className="flex flex-col items-center gap-3">
                    {stage.map((node) => {
                      const nodeSprite = SPRITE_BY_ID[node.speciesId];
                      return (
                        <Link key={node.speciesId} href={"/pokedex/" + node.speciesId} className="flex flex-col items-center gap-0.5 rounded-lg p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2">
                          {nodeSprite ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={nodeSprite} alt={node.name} width={40} height={40} className="h-10 w-10 object-contain" />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
                          )}
                          <span className="text-xs text-center text-zinc-600 dark:text-zinc-300 leading-tight max-w-[4rem]">{node.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}
