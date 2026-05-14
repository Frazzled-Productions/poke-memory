import { notFound } from "next/navigation";
import Link from "next/link";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { PokemonDetailDisclosure } from "@/components/pokedex/PokemonDetailDisclosure";

export function generateStaticParams() {
  return SEED_POKEMON.map((p) => ({ id: String(p.id) }));
}

export default async function PokemonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  if (!/^\d+$/.test(idStr)) return notFound();
  const id = Number(idStr);
  if (id < 1) return notFound();

  const pokemon = SEED_POKEMON.find((p) => p.id === id);
  if (!pokemon) return notFound();

  // All other forms of the same species (parent + siblings), excluding self.
  // On a default-form page this shows alt-forms; on an alt-form page it shows
  // the base species + any sibling alt-forms.
  const forms = SEED_POKEMON.filter(
    (p) => p.speciesId === pokemon.speciesId && p.id !== pokemon.id,
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
