import { Suspense } from "react";
import Link from "next/link";
import { NavLinks, NavLinksFallback } from "./NavLinks";
import { FavouriteMascot } from "./theme/FavouriteMascot";
import { MobileNavSlot } from "@/components/MobileNavSlot";

export function Nav() {
  return (
    <header className="border-b border-theme-secondary bg-theme-primary pt-[env(safe-area-inset-top)]">
      <nav
        className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"
        aria-label="Main navigation"
      >
        {/* Brand — always visible */}
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-bold tracking-tight text-theme-fg-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
          data-superuser-tap="true"
        >
          <span aria-hidden="true">
            <FavouriteMascot />
          </span>
          poke-memory
        </Link>

        {/* Desktop horizontal link row — hidden below md */}
        <div className="hidden md:flex md:items-center md:gap-1">
          <Suspense fallback={<NavLinksFallback />}>
            <NavLinks />
          </Suspense>
        </div>

        {/* Mobile slot — hamburger or auth cluster depending on mobileNav setting */}
        <MobileNavSlot />
      </nav>
    </header>
  );
}
