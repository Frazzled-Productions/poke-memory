import { notFound } from "next/navigation";
import Link from "next/link";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { PokemonDetailDisclosure } from "@/components/pokedex/PokemonDetailDisclosure";

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
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10 sm:py-14">
      <div className="w-full max-w-2xl">
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
      </div>
    </div>
  );
}
