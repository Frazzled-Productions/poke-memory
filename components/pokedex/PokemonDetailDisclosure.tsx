"use client";

import React, { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCardClass } from "@/lib/review/useCardClass";
import { useNextReviewDate } from "@/lib/review/useNextReviewDate";
import { colStack, sectionLabelSmSubtle } from "@/lib/utils/class-names";
import type { SeedPokemon, EvolutionNode } from "@/lib/pokemon/seed";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { getPokemonFacts, loadFlavorTexts } from "@/lib/pokemon/facts";
import { TYPE_COLORS } from "@/lib/pokemon/types";
import type { CardClassOrPending } from "@/lib/review/useCardClass";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";
import { NameTtsButton } from "@/components/pokedex/NameTtsButton";
import { CryButton } from "@/components/pokedex/CryButton";
import { SpritePreloader } from "@/components/sprites/SpritePreloader";
import {
  POKEDEX_DETAIL_SPRITE_SIZE,
  POKEDEX_FORM_SPRITE_SIZE,
  POKEDEX_NODE_SPRITE_SIZE,
} from "@/lib/sprites/sizes";

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
  const { flags } = useSuperuser();
  const nodeSprite = SPRITE_BY_ID[node.speciesId];
  const rawNodeClass: CardClassOrPending = useCardClass(node.speciesId);
  const nodeClass: CardClassOrPending =
    flags.pretendAllMastered && rawNodeClass !== "pending" ? "mastered" : rawNodeClass;
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
      aria-label={nodeLocked ? `Pokémon #${zeroPad(node.speciesId)} (locked)` : node.name}
      className="flex flex-col items-center gap-0.5 rounded-lg p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
    >
      {nodeSprite ? (
        <Image
          src={nodeSprite}
          alt={nodeLocked ? `#${zeroPad(node.speciesId)} (locked)` : node.name}
          width={POKEDEX_NODE_SPRITE_SIZE}
          height={POKEDEX_NODE_SPRITE_SIZE}
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

// ---------------------------------------------------------------------------
// FormBlock — collapsible block for a single alternate form
// ---------------------------------------------------------------------------

function FormBlock({ form }: { form: SeedPokemon }) {
  // Resolve locale-aware name so alternate-form headings honour the active
  // pokemonNameLocale setting (#1327).
  // eslint-disable-next-line no-restricted-syntax -- displayName is the English-fallback arg to useLocalePokemonName, not a direct render
  const { name: formLocaleName } = useLocalePokemonName(form.speciesId, form.displayName);
  return (
    <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer select-none list-none items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded-lg">
        {/* Sprite thumbnail */}
        <Image
          src={`/sprites/pokemon/${form.id}.png`}
          alt={formLocaleName}
          width={POKEDEX_NODE_SPRITE_SIZE}
          height={POKEDEX_NODE_SPRITE_SIZE}
          className="h-10 w-10 object-contain"
        />
        <span className="flex-1 text-sm font-medium text-foreground">
          {formLocaleName}
        </span>
        {/* Chevron */}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div className="border-t border-zinc-200 px-4 pb-4 pt-3 dark:border-zinc-800">
        {/* Full sprite */}
        <div className="mb-3 flex justify-center">
          <Image
            src={`/sprites/pokemon/${form.id}.png`}
            alt={formLocaleName}
            width={POKEDEX_FORM_SPRITE_SIZE}
            height={POKEDEX_FORM_SPRITE_SIZE}
            className="h-28 w-28 object-contain"
          />
        </div>

        {/* Types */}
        <div className="mb-3 flex justify-center gap-2" aria-label="Types">
          {form.types.map((type) => {
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

        {/* Audio buttons */}
        <div className="flex justify-center gap-2">
          <NameTtsButton name={formLocaleName} id={form.id} />
          <CryButton cryUrl={form.cryUrl} label={formLocaleName} />
        </div>
      </div>
    </details>
  );
}

export function PokemonDetailDisclosure({
  pokemon,
  forms = [],
}: {
  pokemon: SeedPokemon;
  forms?: SeedPokemon[];
}) {
  const t = useTranslations("pokedex");
  const { flags } = useSuperuser();
  const { id, name, spriteUrl, types, stats, flavorText, evolutionChain } = pokemon;
  const rawCardClass = useCardClass(id);
  const cardClass =
    flags.pretendAllMastered && rawCardClass !== "pending" ? "mastered" : rawCardClass;
  const isPending = cardClass === "pending";
  const isLocked = cardClass === "locked";
  const isMasteredCard = cardClass === "mastered";
  const isLearning = cardClass === "learning";
  // Always called (hooks must not be conditional). Only rendered when
  // pretendAllMastered is off — the flag fakes mastery state without altering
  // the SRS schedule, so showing schedule info alongside faked-mastery UI
  // would be misleading.
  const nextReview = useNextReviewDate(id);
  // Resolve locale-aware name for audio buttons on the main species heading.
  // Falls back to `name` synchronously until the locale sidecar loads (#1327).
  // eslint-disable-next-line no-restricted-syntax -- displayName is the English-fallback arg to useLocalePokemonName, not a direct render
  const { name: pokemonLocaleName } = useLocalePokemonName(pokemon.speciesId, pokemon.displayName);

  // Kick off flavor-text fetch the first time any disclosure opens. The cache
  // is shared across all instances so concurrent disclosures only fetch once.
  useEffect(() => {
    void loadFlavorTexts();
  }, []);

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

  // Collect evo-chain sprite URLs (excluding the current Pokémon, which is
  // already the main visible image) and warm them in the background so nodes
  // render without pop-in when the chain section scrolls into view.
  // Only preload when the Evolution Chain section will actually render — if
  // the card is not mastered or there are no multi-stage siblings, the section
  // is hidden and pre-fetching those sprites would waste bytes.
  const evoNodeUrls =
    isMasteredCard && showEvolution
      ? evolutionChain
          .filter((node) => node.speciesId !== id)
          .map((node) => SPRITE_BY_ID[node.speciesId])
          .filter((url): url is string => Boolean(url))
      : [];

  return (
    <>
      {evoNodeUrls.length > 0 && (
        <SpritePreloader
          sizedUrls={evoNodeUrls.map((src) => ({
            src,
            width: POKEDEX_NODE_SPRITE_SIZE,
          }))}
        />
      )}
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm font-mono text-zinc-400 dark:text-zinc-500">
          #{zeroPad(id)}
        </p>
        <Image
          src={spriteUrl}
          alt={isLocked ? `#${zeroPad(id)} (locked)` : name}
          width={POKEDEX_DETAIL_SPRITE_SIZE}
          height={POKEDEX_DETAIL_SPRITE_SIZE}
          priority
          className={[
            "h-48 w-48 object-contain",
            isLocked ? "brightness-0" : isLearning ? "grayscale opacity-60" : "",
          ].join(" ")}
        />
        {isLocked ? (
          <h1 className="text-3xl font-bold tracking-tight text-zinc-300 dark:text-zinc-700">???</h1>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{pokemonLocaleName}</h1>
            <NameTtsButton name={pokemonLocaleName} id={pokemon.id} />
            <CryButton cryUrl={pokemon.cryUrl} label={pokemonLocaleName} />
          </div>
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

      {!isLocked &&
        !flags.pretendAllMastered &&
        nextReview.status !== "pending" &&
        nextReview.status !== "not-started" && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {nextReview.status === "due-today"
              ? "Due today"
              : t("nextReviewInDays", { count: nextReview.days })}
          </p>
        )}

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
            className={`mb-3 ${sectionLabelSmSubtle}`}
          >
            Base Stats
          </h2>
          <dl className={colStack}>
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
            className={`mb-3 ${sectionLabelSmSubtle}`}
          >
            Facts
          </h2>
          <dl className={colStack}>
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
            className={`mb-4 ${sectionLabelSmSubtle}`}
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

      {!isLocked && forms.length > 0 && (
        <section aria-labelledby="forms-heading" className="mt-10">
          <h2
            id="forms-heading"
            className={`mb-4 ${sectionLabelSmSubtle}`}
          >
            Forms
          </h2>
          <div className={colStack}>
            {forms.map((form) => (
              <FormBlock key={form.id} form={form} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
