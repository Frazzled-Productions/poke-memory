"use client";

/**
 * LanguageSwitcher — a compact pill that opens a sheet for choosing the
 * Pokémon-name language (`pokemonNameLocale`). It sits with the profile status
 * chips (in `ProfileStatusBar` and, on mobile Practice, in `StreakBadge`).
 *
 * Scope: this switches ONLY the Pokémon-name language, not the app/UI language
 * (that stays in Settings so a user cannot trap themselves in unreadable
 * chrome). Gated behind the `languages` Labs flag via `usePokemonLocaleContext`
 * — renders nothing until the flag is on.
 *
 * Responsive: a bottom sheet on mobile, a centred modal on desktop. The a11y
 * contract (role="dialog" + aria-modal, focus move-in, focus trap, Escape +
 * click-outside to close, focus return to the trigger) mirrors `NavDrawer`.
 *
 * Switching writes `pokemonNameLocale` via `saveSettings`, which dispatches
 * `SETTINGS_SAVED_EVENT`; `PokemonLocaleProvider` listens and re-resolves, so
 * names update live across the app without a reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePokemonLocaleContext } from "@/lib/i18n/PokemonLocaleContext";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { LOCALE_ENDONYMS, type AppLocale } from "@/i18n/locales";
import { mutedTextXs } from "@/lib/utils/class-names";
import {
  readDueCountCache,
  type DueCountByLocale,
} from "@/lib/profile/dueCountCache";
import { KEY_DUE_COUNT_BY_LOCALE } from "@/lib/storage/keys";

// ─── Icons (lucide-style) ──────────────────────────────────────────────────────

function ChevronDownIcon() {
  return (
    <svg
      className="size-3 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function LanguageSwitcher() {
  const t = useTranslations("languageSwitcher");
  const { locale, languagesEnabled, learningLocales } =
    usePokemonLocaleContext();
  const [open, setOpen] = useState(false);
  const [dueCounts, setDueCounts] = useState<DueCountByLocale | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Escape to close + focus trap inside the panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Click outside the panel (and the trigger) closes it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const panel = panelRef.current;
      const trigger = triggerRef.current;
      if (!panel || !trigger) return;
      if (
        !panel.contains(e.target as Node) &&
        !trigger.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Move focus to the selected option when the panel opens.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const checked = panel.querySelector<HTMLElement>(
      '[role="radio"][aria-checked="true"]',
    );
    (checked ?? panel.querySelector<HTMLElement>("button"))?.focus();
  }, [open]);

  // Read the per-locale due-count cache when the dropdown opens, and keep it
  // live while open (ReviewSession writes the cache after grades). The cache is
  // a lightweight read, not a full card-array parse.
  useEffect(() => {
    if (!open) return;
    setDueCounts(readDueCountCache());
    function onStorage(e: StorageEvent) {
      if (e.key === KEY_DUE_COUNT_BY_LOCALE) setDueCounts(readDueCountCache());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [open]);

  if (!languagesEnabled) return null;

  function selectLocale(next: AppLocale) {
    const settings = loadSettings();
    if (settings.activePokemonNameLocale !== next) {
      saveSettings({ ...settings, activePokemonNameLocale: next });
    }
    close();
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("pillAriaLabel", { language: LOCALE_ENDONYMS[locale] })}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors [@media(hover:hover)]:hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1 dark:border-zinc-600 dark:[@media(hover:hover)]:hover:bg-zinc-800"
      >
        <span lang={locale}>{LOCALE_ENDONYMS[locale]}</span>
        <ChevronDownIcon />
      </button>

      {/* Anchored dropdown directly below the pill (not a detached bottom
          sheet), so focus and attention stay where the user tapped. Closes on
          Escape, click-outside, or selecting a language. */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby="language-switcher-heading"
          className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-background p-2 shadow-xl dark:border-zinc-700"
        >
          <h2
            id="language-switcher-heading"
            className="px-2 pb-1.5 pt-1 text-xs font-semibold text-foreground"
          >
            {t("heading")}
          </h2>

          <div role="radiogroup" aria-label={t("groupAriaLabel")}>
            {learningLocales.map((loc) => {
              const selected = loc === locale;
              const due = dueCounts?.[loc] ?? 0;
              return (
                <button
                  key={loc}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={t("dueTodayAriaLabel", {
                    language: LOCALE_ENDONYMS[loc],
                    count: due,
                  })}
                  onClick={() => selectLocale(loc)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors [@media(hover:hover)]:hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:[@media(hover:hover)]:hover:bg-zinc-800"
                >
                  <span className="flex flex-col">
                    <span
                      lang={loc}
                      className="text-sm font-medium text-foreground"
                    >
                      {LOCALE_ENDONYMS[loc]}
                    </span>
                    {loc !== "en" && (
                      <span className={mutedTextXs}>
                        {t("machineTranslation")}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={mutedTextXs} aria-hidden="true">
                      {t("dueToday", { count: due })}
                    </span>
                    {selected && <CheckIcon />}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Enrol more languages from the Settings section. */}
          <Link
            href="/settings#languages-learning"
            onClick={close}
            className={`mt-1 flex min-h-[44px] w-full items-center rounded-lg px-2 py-1.5 text-left text-sm transition-colors [@media(hover:hover)]:hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:[@media(hover:hover)]:hover:bg-zinc-800 ${mutedTextXs}`}
          >
            {t("addLanguage")}
          </Link>

          <p className={`mt-1 px-2 pb-1 ${mutedTextXs}`}>
            {t("appLanguageHint")}
          </p>
        </div>
      )}
    </span>
  );
}
