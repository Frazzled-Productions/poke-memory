"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { loadFavourite } from "@/lib/theme/persistence";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { CURATED_POKEMON } from "@/lib/theme/curated-pokemon";

export function FavouriteMascot() {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    function sync() {
      const stored = loadFavourite();
      if (stored === null) {
        setSpriteUrl(null);
        setName(null);
        return;
      }
      const pokemon = SEED_POKEMON.find((p) => p.id === stored.id);
      const curated = CURATED_POKEMON.find((p) => p.id === stored.id);
      setSpriteUrl(pokemon?.spriteUrl ?? null);
      setName(curated?.name ?? pokemon?.name ?? null);
    }

    sync();

    function handleStorage(e: StorageEvent) {
      if (e.key === "poke-memory:favourite:v1") sync();
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  if (spriteUrl === null) return null;

  return (
    <Image
      src={spriteUrl}
      alt={name ?? "Favourite Pokémon"}
      width={32}
      height={32}
      className="h-8 w-8 object-contain"
      unoptimized
    />
  );
}
