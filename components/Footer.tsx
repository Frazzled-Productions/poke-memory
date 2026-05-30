"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { mutedTextXs } from "@/lib/utils/class-names";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

export function Footer() {
  const t = useTranslations("nav");
  const [year, setYear] = useState<number | null>(null);
  // Initialise to null so the first client render matches the server render
  // (both produce the footer), avoiding a React hydration mismatch for users
  // whose persisted setting is "bottom". The real value is applied in
  // useEffect after mount.
  const [mobileNav, setMobileNav] = useState<"bottom" | "hamburger" | null>(null);

  useEffect(() => {
    setYear(new Date().getFullYear());
    setMobileNav(loadSettings().mobileNav);

    function onSaved() {
      setMobileNav(loadSettings().mobileNav);
    }
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, []);

  // In bottom-nav (app-like) mode the footer is hidden — it would sit
  // underneath the fixed tab bar and is unreachable. Privacy / Terms / the
  // fan-project disclaimer remain accessible via Settings → About.
  if (mobileNav === "bottom") return null;
  return (
    <footer className="border-t border-zinc-200 bg-background dark:border-zinc-800">
      <div className={`mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3 text-center ${mutedTextXs}`}>
        <span>{year !== null ? `© ${year} Frazzled Productions` : " "}</span>
        <span aria-hidden="true">·</span>
        <Link
          href="/whats-new"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          {t("whatsNew")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/privacy"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          {t("privacy")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link
          href="/terms"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          {t("terms")}
        </Link>
        <span aria-hidden="true">·</span>
        <span className="font-mono">v{APP_VERSION}</span>
      </div>
      <p className="mx-auto max-w-5xl px-4 pb-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
        Unofficial fan project, not affiliated with or endorsed by Nintendo,
        Game Freak, or The Pokémon Company. Pokémon and all related names,
        sprites, and cries are the property of their respective owners.
        Sprite and species data sourced from{" "}
        <a
          href="https://pokeapi.co"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 rounded"
        >
          PokéAPI
        </a>
        .
      </p>
    </footer>
  );
}
