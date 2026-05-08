"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/", label: "Practice" },
  { href: "/stats", label: "Stats" },
  { href: "/pokedex", label: "Pokédex" },
  { href: "/settings", label: "Settings" },
] as const;

const LINK_BASE =
  "rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1" role="list">
      {NAV_LINKS.map(({ href, label }) => {
        const isActive = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={[
                LINK_BASE,
                isActive
                  ? "bg-foreground text-background"
                  : "text-zinc-600 hover:text-foreground dark:text-zinc-400 dark:hover:text-foreground",
              ].join(" ")}
            >
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function NavLinksFallback() {
  return (
    <ul className="flex items-center gap-1" role="list">
      {NAV_LINKS.map(({ href, label }) => (
        <li key={href}>
          <Link
            href={href}
            className={`${LINK_BASE} text-zinc-600 hover:text-foreground dark:text-zinc-400 dark:hover:text-foreground`}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
