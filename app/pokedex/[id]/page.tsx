import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { PokemonDetailDisclosure } from "@/components/pokedex/PokemonDetailDisclosure";
import { PageShell } from "@/components/ui/PageShell";

function zeroPadId(id: number): string {
  return String(id).padStart(3, "0");
}

/**
 * Per-species metadata (#1734 / #1729).
 *
 * Server-side metadata cannot know per-user lock state, so the <title> always
 * uses the national-dex number only (e.g. "Pokémon #025 - Pokédex - Poké Memory").
 * This also avoids leaking Pokémon species names into search indexes, which suits
 * the project's IP posture.
 *
 * Client-side, PokemonDetailDisclosure updates document.title to the localised
 * species name once the page has loaded AND the species is unlocked/learned.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: idStr } = await params;
  if (!/^\d+$/.test(idStr)) {
    return { title: "Pokédex - Poké Memory" };
  }
  const id = Number(idStr);
  const pokemon = SEED_POKEMON.find((p) => p.id === id);
  if (!pokemon) {
    return { title: "Pokédex - Poké Memory" };
  }
  return {
    title: `Pokémon #${zeroPadId(id)} - Pokédex - Poké Memory`,
    description: `Pokémon #${zeroPadId(id)} in the Pokédex.`,
  };
}

export function generateStaticParams() {
  // One route per species - use only default forms (or all entries when the
  // seed hasn't been re-run with #445 fields yet). Alt-form ids (10001+) are
  // still resolvable via a post-lookup null check in the page component.
  const defaultForms = SEED_POKEMON.filter(
    (p) => p.isDefaultForm === undefined || p.isDefaultForm,
  );
  return defaultForms.map((p) => ({ id: String(p.id) }));
}

export default async function PokemonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  if (!/^\d+$/.test(idStr)) return notFound();
  const id = Number(idStr);

  const pokemon = SEED_POKEMON.find((p) => p.id === id);
  if (!pokemon) return notFound();

  // Collect all non-default forms for this species, excluding the current
  // pokemon itself (so a page for an alt-form won't list itself).
  // speciesId was added in #445; until the seed is re-run this returns [].
  const forms = SEED_POKEMON.filter(
    (p) => p.speciesId === pokemon.speciesId && !p.isDefaultForm && p.id !== pokemon.id,
  );

  return (
    <PageShell width="narrow">
      <Link
        href="/pokedex"
        className="mb-8 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400 dark:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded"
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
          <path
            d="M10 3L5 8L10 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Pok&#233;dex
      </Link>
      <PokemonDetailDisclosure pokemon={pokemon} forms={forms} />
    </PageShell>
  );
}
