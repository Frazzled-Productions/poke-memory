"use client";

import Image from "next/image";
import { useFavourite } from "./FavouriteThemeProvider";

export function FavouriteMascot() {
  const { favourite } = useFavourite();

  if (favourite === null || favourite.spriteUrl === null) return null;

  return (
    <Image
      src={favourite.spriteUrl}
      alt=""
      width={32}
      height={32}
      className="h-8 w-8 object-contain"
      unoptimized
    />
  );
}
