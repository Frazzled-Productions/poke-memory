"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthButton } from "@/components/auth/AuthButton";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { filterMastered } from "@/lib/pasture/arrivals";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { WhatsNewIndicator } from "@/components/whats-new/WhatsNewIndicator";

const NAV_LINKS = [
  { href: "/", label: "Practice" },
  { href: "/stats", label: "Stats" },
  { href: "/journey", label: "Journey" },
  { href: "/pokedex", label: "Pokédex" },
  { href: "/settings", label: "Settings" },
] as const;

const LINK_BASE =
  "rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 [@media(hover:hover)]:hover:bg-white/20";

export function NavLinks() {
  const pathname = usePathname();
  const { flags } = useSuperuser();
  const [hasMastered, setHasMastered] = useState(false);
  // Re-runs the mastery check when the session key changes — native cross-tab
  // events and the synthetic dispatch from pullAndMerge / pasture sparkle
  // clears both flow through this hook.
  const sessionVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  // Also re-runs when the user saves Settings, so a change to the
  // masteryRepetitions threshold re-derives Pasture link visibility without
  // waiting for an unrelated session storage bump.
  const [settingsVersion, setSettingsVersion] = useState(0);

  useEffect(() => {
    function onSaved() {
      setSettingsVersion((v) => v + 1);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  useEffect(() => {
    async function load() {
      const session = await loadSession();
      const masteryRepetitions = loadSettings().masteryRepetitions;
      setHasMastered(
        session !== null &&
          filterMastered(session.cards, false, masteryRepetitions).length > 0,
      );
    }
    void load();
  }, [sessionVersion, settingsVersion]);

  const showPasture = hasMastered || flags.pretendAllMastered;

  return (
    <>
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
                    ? "bg-theme-fg-on-primary text-theme-primary"
                    : "text-theme-fg-on-primary opacity-75 hover:opacity-100",
                ].join(" ")}
              >
                {label}
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
                  : "text-theme-fg-on-primary opacity-75 hover:opacity-100",
              ].join(" ")}
            >
              Pasture
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
  return (
    <ul className="flex items-center gap-1" role="list">
      {NAV_LINKS.map(({ href, label }) => (
        <li key={href}>
          <Link
            href={href}
            className={`${LINK_BASE} text-theme-fg-on-primary opacity-75 hover:opacity-100`}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
