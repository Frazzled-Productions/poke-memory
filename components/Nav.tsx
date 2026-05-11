import { Suspense } from "react";
import Link from "next/link";
import { NavLinks, NavLinksFallback } from "./NavLinks";
import { FavouriteMascot } from "./theme/FavouriteMascot";

export function Nav() {
  return (
    <header className="border-b border-zinc-200 bg-background dark:border-zinc-800">
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3"
        aria-label="Main navigation"
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded"
        >
          <FavouriteMascot />
          poke-memory
        </Link>

        <Suspense fallback={<NavLinksFallback />}>
          <NavLinks />
        </Suspense>
      </nav>
    </header>
  );
}
