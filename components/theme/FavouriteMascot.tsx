"use client";

import Image from "next/image";
import { useFavourite } from "./FavouriteThemeProvider";
import { FAVOURITE_MASCOT_SPRITE_SIZE } from "@/lib/sprites/sizes";

export function FavouriteMascot() {
  const { favourite } = useFavourite();

  if (favourite === null || favourite.spriteUrl === null) return null;

  return (
    <Image
      src={favourite.spriteUrl}
      alt=""
      width={FAVOURITE_MASCOT_SPRITE_SIZE}
      height={FAVOURITE_MASCOT_SPRITE_SIZE}
      className="h-8 w-8 object-contain"
    />
  );
}
