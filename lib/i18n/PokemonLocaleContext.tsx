"use client";
// lib/i18n/PokemonLocaleContext.tsx
// Shared context for the Pokémon-name locale and languages-flag state (#1329).
//
// The context is the single subscription point for `pokemonNameLocale` and the
// `languages` feature state. With N cards on screen, the old per-hook model
// registered N event listeners and called loadSettings() N times per render.
// This provider registers exactly one pair of listeners regardless of how many
// components call `usePokemonLocaleContext()`, reducing hydration cost from
// O(N) to O(1) for the locale-subscription leg.
//
// Multi-locale is now always-on (#1723): `languagesEnabled` is always `true`.
// The field is kept in the context shape for back-compat with consumers that
// already read it; they will always see `true` and can be simplified over time.
//
// Place <PokemonLocaleProvider> high in the tree (app/layout.tsx, inside
// <LocaleProvider>) so all review and Pokédex surfaces share the same
// subscription.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { loadSettings, SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export type PokemonLocaleContextValue = {
  /** The active Pokémon-name locale, already gated by the languages flag. */
  locale: AppLocale;
  /**
   * Whether the languages feature is enabled. Always `true` since multi-locale
   * went GA (#1723). Kept in the context shape for back-compat.
   */
  languagesEnabled: boolean;
  /**
   * The set of enrolled learning locales (#1484), English always first. Used by
   * the LanguageSwitcher to render the options. Always `["en"]` when the flag is
   * off.
   */
  learningLocales: AppLocale[];
};

const PokemonLocaleCtx = createContext<PokemonLocaleContextValue>({
  locale: DEFAULT_LOCALE,
  // Multi-locale is always-on since GA (#1723).
  languagesEnabled: true,
  learningLocales: [DEFAULT_LOCALE],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readLocaleState(): PokemonLocaleContextValue {
  if (typeof window === "undefined") {
    return {
      locale: DEFAULT_LOCALE,
      // Multi-locale is always-on since GA (#1723).
      languagesEnabled: true,
      learningLocales: [DEFAULT_LOCALE],
    };
  }
  const settings = loadSettings();
  // Multi-locale is always-on since GA (#1723): languagesEnabled is always true.
  // Active locale (#1484): activePokemonNameLocale is authoritative;
  // pokemonNameLocale is the back-compat alias; DEFAULT_LOCALE the safety net.
  const locale =
    settings.activePokemonNameLocale ??
    settings.pokemonNameLocale ??
    DEFAULT_LOCALE;
  return {
    locale,
    languagesEnabled: true,
    learningLocales: settings.learningLocales ?? [DEFAULT_LOCALE],
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Provides the active Pokémon-name locale to all descendants via Context.
 *
 * Registers a single pair of event listeners (`SETTINGS_SAVED_EVENT` and
 * `storage`) regardless of how many components consume the context.  The
 * previous per-hook model registered O(N) listeners for N cards on screen,
 * which pushed practice-page hydration past WebKit's 30 s CI timeout when
 * three more call sites were added in #1329.
 *
 * Mount once at the root layout, inside `<LocaleProvider>` (which provides
 * next-intl) so both layers are available to the full tree.
 */
export function PokemonLocaleProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PokemonLocaleContextValue>(readLocaleState);

  useEffect(() => {
    function handleChange() {
      setState(readLocaleState());
    }
    // `useState(readLocaleState)` already produced the correct initial value
    // on mount - only the listeners are needed here. (An extra `handleChange()`
    // call would force a second render with a fresh object reference, defeating
    // the per-tree overhead reduction this Provider exists to deliver.)
    window.addEventListener(SETTINGS_SAVED_EVENT, handleChange);
    window.addEventListener("storage", handleChange);
    return () => {
      window.removeEventListener(SETTINGS_SAVED_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  // Stabilise the value object so Context consumers only re-render when the
  // locale, flag, or enrolled set actually changes, not on unrelated saves.
  // Key on the learning-set CONTENT (not its array reference, which is fresh on
  // every settings save) so a streak/token save does not churn consumers.
  const learningKey = state.learningLocales.join(",");
  const value = useMemo(
    () => ({
      locale: state.locale,
      // Multi-locale is always-on since GA (#1723).
      languagesEnabled: true as const,
      learningLocales: state.learningLocales,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.locale, learningKey],
  );

  return <PokemonLocaleCtx.Provider value={value}>{children}</PokemonLocaleCtx.Provider>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the active Pokémon-name locale and languages-flag state from the
 * nearest `<PokemonLocaleProvider>`.
 *
 * Renders are O(1) - only re-runs when the locale or flag value changes,
 * regardless of the number of call sites on screen.
 */
export function usePokemonLocaleContext(): PokemonLocaleContextValue {
  return useContext(PokemonLocaleCtx);
}
