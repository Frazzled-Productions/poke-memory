"use client";

/**
 * MachineTranslationBanner — dismissible caution banner for non-English locales.
 *
 * Shown once per locale until the user dismisses it. Dismissal is persisted
 * in a standalone localStorage key per locale (for fast synchronous reads)
 * AND in `user_settings.dismissedMtBannerLocales` (for cross-device sync).
 *
 * Cross-device sync: on dismiss, `saveSettings` is called with the updated
 * `dismissedMtBannerLocales` array; `AutoSyncOnChange` picks this up and
 * pushes the change to Supabase via the best-effort settings leg. On pull,
 * `pullAndMerge` unions cloud locales into the standalone localStorage keys
 * so this component's read path requires no changes (AC2 of #1387).
 *
 * LWW caveat: the `merge_user_settings` RPC `||` overlay OVERWRITES arrays
 * rather than unioning them. In the rare case where two devices dismiss
 * different locales before syncing, the last push wins and a banner may
 * re-show once on the other device. Acceptable for a cosmetic banner.
 *
 * The banner is intentionally NOT rendered in the English locale — the English
 * UI is the authoritative version and needs no machine-translation caveat.
 *
 * localStorage key format: `poke-memory:mt-banner-dismissed:<locale>`
 * (e.g. `poke-memory:mt-banner-dismissed:ja`)
 *
 * Rendered at the page level (app/layout.tsx) AND inside FirstVisitOnboardingModal
 * so the notice stays visible when the modal occludes the page.
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAppLocale } from "@/lib/i18n/useAppLocale";
import { LOCALE_ENDONYMS } from "@/i18n/locales";
import { loadSettings, saveSettings } from "@/lib/settings/persistence";
import { mtBannerDismissedKey } from "@/lib/storage/keys";

export function MachineTranslationBanner() {
  const t = useTranslations("banner");
  const locale = useAppLocale();

  // null = not yet read from localStorage (avoid flash on hydration).
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    // Read the per-locale dismissed flag after hydration so SSR and the first
    // paint are consistent. Without this guard the server renders the banner
    // open (it has no localStorage), and the client immediately hides it —
    // producing a visible flash.
    const stored = localStorage.getItem(mtBannerDismissedKey(locale));
    setDismissed(stored === "1");
  }, [locale]);

  function handleDismiss() {
    // Write the standalone key (fast synchronous read path — component never
    // changes its useEffect to read from settings directly).
    localStorage.setItem(mtBannerDismissedKey(locale), "1");
    setDismissed(true);

    // Also persist in UserSettings so the dismissal syncs to other devices via
    // the best-effort settings leg in AutoSyncOnChange. saveSettings dispatches
    // SETTINGS_SAVED_EVENT, which AutoSyncOnChange handles; the superuser write-
    // guard is enforced there (userId = null when anyFlagOn), so AC4 is
    // satisfied without any extra guard here.
    const current = loadSettings();
    if (!current.dismissedMtBannerLocales.includes(locale)) {
      saveSettings({
        ...current,
        dismissedMtBannerLocales: [...current.dismissedMtBannerLocales, locale],
      });
    }
  }

  // Do not render for English — the authoritative locale needs no disclaimer.
  // Also skip while hydrating (dismissed === null) to avoid a layout shift.
  if (locale === "en" || dismissed !== false) return null;

  const language = LOCALE_ENDONYMS[locale];

  return (
    <div
      role="note"
      data-testid="machine-translation-banner"
      className="w-full bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800"
    >
      <div className="mx-auto flex max-w-3xl items-start gap-3 px-4 py-3 sm:items-center">
        {/* Warning icon — decorative, aria-hidden */}
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400 sm:mt-0">
          &#9888;&#xFE0F;
        </span>

        <p className="flex-1 text-sm leading-snug text-amber-900 dark:text-amber-100">
          {t("machineTranslated", { language })}
        </p>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("dismiss")}
          className="shrink-0 rounded p-1 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          {t("dismiss")}
        </button>
      </div>
    </div>
  );
}
