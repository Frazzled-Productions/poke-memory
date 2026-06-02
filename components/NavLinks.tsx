"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { AuthButton } from "@/components/auth/AuthButton";
import { usePastureMasteryState } from "@/lib/pasture/usePastureMasteryState";
import { WhatsNewIndicator } from "@/components/whats-new/WhatsNewIndicator";

// NAV_LINKS_HREFS is kept module-level (href is not locale-dependent).
// Labels are derived inside the component so `t()` is available.
const NAV_LINKS_HREFS = [
  { href: "/", key: "practice" },
  { href: "/stats", key: "stats" },
  { href: "/journey", key: "journey" },
  { href: "/pokedex", key: "pokedex" },
  { href: "/settings", key: "settings" },
] as const;

const LINK_BASE =
  "rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 [@media(hover:hover)]:hover:bg-white/20";

export function NavLinks() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { showPasture } = usePastureMasteryState();

  return (
    <>
      <ul className="flex items-center gap-1" role="list">
        {NAV_LINKS_HREFS.map(({ href, key }) => {
          const isActive = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  LINK_BASE,
                  isActive
                    ? "bg-theme-fg-on-primary text-theme-primary"
                    : "text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100",
                ].join(" ")}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
        {showPasture && (
          <li>
            <Link
              href="/pasture"
              aria-current={pathname === "/pasture" ? "page" : undefined}
              className={[
                LINK_BASE,
                pathname === "/pasture"
                  ? "bg-theme-fg-on-primary text-theme-primary"
                  : "text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100",
              ].join(" ")}
            >
              {t("pasture")}
            </Link>
          </li>
        )}
      </ul>
      <WhatsNewIndicator />
      <AuthButton />
    </>
  );
}

export function NavLinksFallback() {
  const t = useTranslations("nav");
  return (
    <ul className="flex items-center gap-1" role="list">
      {NAV_LINKS_HREFS.map(({ href, key }) => (
        <li key={href}>
          <Link
            href={href}
            className={`${LINK_BASE} text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100`}
          >
            {t(key)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
