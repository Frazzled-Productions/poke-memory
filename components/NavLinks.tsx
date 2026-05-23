"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthButton } from "@/components/auth/AuthButton";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY } from "@/lib/review/persistence";
import { filterMastered } from "@/lib/pasture/arrivals";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { WhatsNewIndicator } from "@/components/whats-new/WhatsNewIndicator";
import { KEY_HAS_MASTERED } from "@/lib/storage/keys";

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
  // Re-runs the mastery check when the session key changes via a cross-tab
  // StorageEvent (e.g. sync pull from another tab, or the E2E seed helper).
  // The per-grade SESSION_CHANGED_EVENT is no longer the trigger — instead,
  // ReviewSession writes KEY_HAS_MASTERED on the first mastery transition so
  // the Pasture link appears without re-parsing the full IDB blob on every
  // grade (#1191 Class A item 3).
  const sessionVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  // Also re-runs when the user saves Settings, so a change to the
  // masteryRepetitions threshold re-derives Pasture link visibility without
  // waiting for an unrelated session storage bump.
  const [settingsVersion, setSettingsVersion] = useState(0);
  // Responds to ReviewSession writing KEY_HAS_MASTERED when a card first
  // crosses the mastery threshold, or when the flag is cleared on reset.
  const hasMasteredVersion = useLocalStorageKey(KEY_HAS_MASTERED);
  // Tracks the write epoch seen when the mastery effect last attached its
  // listener, to detect writes that happened before React hydrated.
  const epochAtLastAttach = useRef<number>(0);

  useEffect(() => {
    function onSaved() {
      setSettingsVersion((v) => v + 1);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  useEffect(() => {
    // Fast path: once the flag is `"true"`, at least one species is mastered
    // and the Pasture link should be shown. We only cache `"true"` — a
    // missing or non-"true" flag means we do the full check so that threshold
    // changes (via SETTINGS_SAVED_EVENT) are always reflected correctly.
    async function load() {
      // useEffect already gates this to browser-only; no SSR guard needed.
      if (localStorage.getItem(KEY_HAS_MASTERED) === "true") {
        setHasMastered(true);
        return;
      }
      // Flag absent or "false" — do the full check.
      const session = await loadSession();
      const masteryRepetitions = loadSettings().masteryRepetitions;
      const result =
        session !== null &&
        filterMastered(session.cards, false, masteryRepetitions).length > 0;
      setHasMastered(result);
    }
    void load();

    // Catch-up check: if a write happened before this effect registered its
    // listener (e.g. the E2E seed fires tx.oncomplete before React hydrates),
    // the epoch on window will be higher than what we recorded last time.
    const epochNow = window.__pokeMemorySessionWriteEpoch ?? 0;
    if (epochNow !== epochAtLastAttach.current) {
      epochAtLastAttach.current = epochNow;
      requestAnimationFrame(() => { void load(); });
    }
  }, [sessionVersion, settingsVersion, hasMasteredVersion]);

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
                    : "text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100",
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
                  : "text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100",
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
            className={`${LINK_BASE} text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100`}
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
