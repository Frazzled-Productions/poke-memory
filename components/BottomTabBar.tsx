"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { filterMastered } from "@/lib/pasture/arrivals";
import { loadSession, STORAGE_KEY as SESSION_STORAGE_KEY, SESSION_CHANGED_EVENT } from "@/lib/review/persistence";
import { useLocalStorageKey } from "@/lib/hooks/useLocalStorageKey";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";

// ─── SVG icons ──────────────────────────────────────────────────────────────

function PracticeIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Pokéball silhouette — simplified as a card/book icon */}
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function StatsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function PokedexIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PastureIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function JourneyIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Trophy / award cup shape */}
      <path d="M6 9H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
      <path d="M18 9h3a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-3" />
      <path d="M6 4h12v7a6 6 0 0 1-12 0V4z" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

// ─── Static tab definitions ───────────────────────────────────────────────

const STATIC_TABS = [
  { href: "/", label: "Practice", Icon: PracticeIcon },
  { href: "/stats", label: "Stats", Icon: StatsIcon },
  { href: "/journey", label: "Journey", Icon: JourneyIcon },
  { href: "/pokedex", label: "Pokédex", Icon: PokedexIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

// ─── Inner component (requires client hooks) ─────────────────────────────

function BottomTabBarInner() {
  const pathname = usePathname();
  const { flags } = useSuperuser();
  const [hasMastered, setHasMastered] = useState(false);
  // Re-runs the mastery check when the session key changes, matching the logic
  // in NavLinks and NavDrawer.
  const sessionVersion = useLocalStorageKey(SESSION_STORAGE_KEY);
  // Also re-runs the mastery check when the user saves Settings, so a change
  // to the masteryRepetitions threshold re-derives Pasture tab visibility
  // without waiting for an unrelated session storage bump.
  const [settingsVersion, setSettingsVersion] = useState(0);
  // Track mobileNav setting so the bar disappears immediately when the user
  // switches to hamburger mode on the Settings page.
  //
  // Initialise to null so the first client render matches the server render
  // (both produce the "bottom" layout), avoiding a React hydration mismatch
  // for users whose persisted setting is "hamburger". The real value is applied
  // in useEffect after mount.
  const [mobileNav, setMobileNav] = useState<"bottom" | "hamburger" | null>(null);

  useEffect(() => {
    // Apply the persisted value now that we are safely past hydration.
    setMobileNav(loadSettings().mobileNav);

    function onSaved() {
      setMobileNav(loadSettings().mobileNav);
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
    // Also listen for the CustomEvent dispatched after every IDB write (including
    // the E2E test seed helper). WebKit does not reliably propagate synthetic
    // StorageEvents to same-tab `storage` listeners, so the CustomEvent is the
    // authoritative post-write signal for BottomTabBar on mobile-safari.
    window.addEventListener(SESSION_CHANGED_EVENT, load);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, load);
  }, [sessionVersion, settingsVersion]);

  // Hidden in hamburger mode — the NavDrawer handles navigation instead.
  // While mobileNav is null (pre-mount), render the bottom bar to match the
  // server render and avoid a hydration mismatch.
  if (mobileNav === "hamburger") return null;

  const showPasture = hasMastered || flags.pretendAllMastered;

  // Build the tab list, inserting Pasture before Settings when visible.
  const tabs: Array<{
    href: string;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [];

  for (const tab of STATIC_TABS) {
    if (tab.href === "/settings" && showPasture) {
      tabs.push({ href: "/pasture", label: "Pasture", Icon: PastureIcon });
    }
    tabs.push(tab);
  }

  return (
    <nav
      aria-label="Mobile tab navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-theme-secondary bg-theme-primary md:hidden"
    >
      <ul
        role="list"
        className="mx-auto flex max-w-5xl items-stretch justify-around"
      >
        {tabs.map(({ href, label, Icon }) => {
          const isActive =
            pathname === href ||
            (href !== "/" && pathname.startsWith(href + "/"));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={[
                  // py-3 top padding + safe-area-aware bottom padding so the
                  // interactive area extends into the iOS home-indicator strip —
                  // no dead tap zone below the visible icons.
                  // min-h-[44px] ensures the Apple HIG 44pt minimum above the
                  // safe-area inset (the inset itself is additional space).
                  "flex flex-col items-center gap-0.5 px-2 pt-3 min-h-[44px]",
                  "pb-[max(12px,env(safe-area-inset-bottom))]",
                  "text-[10px] font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-inset",
                  isActive
                    ? "text-theme-fg-on-primary"
                    : "text-theme-fg-on-primary opacity-55 [@media(hover:hover)]:hover:opacity-80",
                ].join(" ")}
              >
                <Icon
                  className={isActive ? "opacity-100" : "opacity-70"}
                />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Static fallback rendered while the client bundle is loading. Shows
 * the same tab positions so the layout does not shift during hydration.
 * Uses a plain `<div>` with `aria-hidden` rather than a `<nav>` because a
 * hidden landmark is semantically odd — assistive technology should not
 * discover a nav that provides no interactive content.
 */
function BottomTabBarFallback() {
  return (
    <div
      aria-hidden="true"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-theme-secondary bg-theme-primary md:hidden"
    >
      <ul
        role="list"
        className="mx-auto flex max-w-5xl items-stretch justify-around"
      >
        {STATIC_TABS.map(({ href, label, Icon }) => (
          <li key={href} className="flex-1">
            <span
              className="flex flex-col items-center gap-0.5 px-2 pt-3 min-h-[44px] pb-[max(12px,env(safe-area-inset-bottom))] text-[10px] font-medium text-theme-fg-on-primary opacity-55"
            >
              <Icon />
              <span>{label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Fixed bottom tab bar — visible only on mobile (below the `md` breakpoint).
 *
 * Tabs: Practice / Stats / Pokédex / [Pasture when mastered] / Settings.
 * Active tab is indicated with `aria-current="page"` and full opacity.
 * Respects iOS safe-area-inset-bottom so the bar clears the home indicator.
 */
export function BottomTabBar() {
  return (
    <Suspense fallback={<BottomTabBarFallback />}>
      <BottomTabBarInner />
    </Suspense>
  );
}
