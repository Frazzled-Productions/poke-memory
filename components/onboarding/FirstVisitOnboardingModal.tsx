"use client";

/**
 * One-time first-visit onboarding modal for the Practice page (#1103).
 *
 * Shows on first load; covers grading mechanics, audio features, and guest
 * storage. Once dismissed the `firstVisitOnboardingDismissed` flag is
 * persisted and the modal never re-opens automatically.
 *
 * Re-openable from Settings ("Show onboarding again").
 *
 * Accessibility notes:
 * - Rendered via createPortal so it sits outside #app-root in the DOM.
 * - While open, #app-root receives `inert` and `aria-hidden` so screen-reader
 *   virtual cursor cannot escape into background content.
 * - Previously focused element is restored on dismiss (WCAG 2.1 SC 2.4.3).
 * - Escape key dismisses; Tab/Shift-Tab cycle is trapped inside the dialog.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  DEFAULT_ONBOARDING,
  SETTINGS_SAVED_EVENT,
  loadSettings,
  saveSettings,
} from "@/lib/settings/persistence";
import { useAuth } from "@/lib/auth/AuthContext";
import { cn } from "@/lib/utils/cn";
import { mutedTextXs, sectionLabel } from "@/lib/utils/class-names";
import { MachineTranslationBanner } from "@/components/i18n/MachineTranslationBanner";

type Props = {
  /** Called when the modal closes so the parent can update its state. */
  onDismiss?: () => void;
};

export function FirstVisitOnboardingModal({ onDismiss }: Props) {
  const t = useTranslations("onboarding");
  // null = not yet read from localStorage (SSR / first paint).
  const [open, setOpen] = useState<boolean | null>(null);
  // Whether we have a DOM available (guards createPortal from SSR).
  const [mounted, setMounted] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Stores the element that was focused before the modal opened so focus can
  // be returned there on dismiss (WCAG 2.1 SC 2.4.3).
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Confirm DOM is available before using createPortal.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Read the persisted flag once auth has resolved so we know whether to
  // surface the guest-storage section.
  useEffect(() => {
    const sync = () => {
      const settings = loadSettings();
      const dismissed =
        settings.onboarding?.firstVisitOnboardingDismissed ?? false;
      setOpen(!dismissed);
    };
    sync();
    window.addEventListener(SETTINGS_SAVED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, sync);
  }, []);

  // When the modal opens:
  //   1. Capture the currently focused element so we can restore it on close.
  //   2. Focus the close button so keyboard users land on a meaningful target.
  //   3. Mark #app-root inert + aria-hidden so background content is hidden
  //      from screen-reader virtual cursor and pointer interaction.
  useEffect(() => {
    if (!open) return;

    // Capture previous focus before moving it.
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const appRoot = document.getElementById("app-root");
    if (appRoot) {
      appRoot.setAttribute("inert", "");
      appRoot.setAttribute("aria-hidden", "true");
    }

    return () => {
      // Clean up inert / aria-hidden when modal closes or unmounts.
      if (appRoot) {
        appRoot.removeAttribute("inert");
        appRoot.removeAttribute("aria-hidden");
      }
    };
  }, [open]);

  // Lock background scroll while open and trap Escape to dismiss.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
      // Focus trap: keep Tab and Shift+Tab inside the dialog.
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // dismiss is defined below; listing it as a dep would cause a re-register
    // on every render. The effect depends only on `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    const settings = loadSettings();
    const onboarding = settings.onboarding ?? { ...DEFAULT_ONBOARDING };
    saveSettings({
      ...settings,
      onboarding: { ...onboarding, firstVisitOnboardingDismissed: true },
    });
    setOpen(false);

    // Return focus to where it was before the modal opened. Fall back to the
    // document body if nothing useful was captured (e.g. on page load).
    if (prevFocusRef.current && prevFocusRef.current !== document.body) {
      prevFocusRef.current.focus();
    }

    onDismiss?.();
  }

  // Do not render until we know the flag value (avoids a flash on first paint)
  // or until the DOM is ready for createPortal.
  if (!mounted || open === null || !open) return null;

  const isGuest = !authLoading && user === null;

  // Render into document.body so the dialog sits outside #app-root and is not
  // made inert along with the rest of the page content.
  return createPortal(
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      aria-hidden="false"
    >
      {/* Dialog panel */}
      <dialog
        ref={dialogRef}
        open
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-modal-title"
        className="relative w-full max-w-md rounded-2xl bg-background p-0 shadow-xl focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2
            id="onboarding-modal-title"
            className="text-base font-semibold text-foreground"
          >
            {t("welcomeHeading")}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={dismiss}
            aria-label={t("closeAriaLabel")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <span aria-hidden="true">&#x2715;</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5 max-h-[70vh]">

          {/* Machine-translation notice — self-hides for en and when dismissed */}
          <MachineTranslationBanner />

          {/* Intro */}
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("intro")}
          </p>

          {/* Grading section */}
          <section aria-labelledby="modal-grading-heading">
            <h3
              id="modal-grading-heading"
              className={cn("mb-2", sectionLabel)}
            >
              {t("howToGrade.heading")}
            </h3>
            <ul className="flex flex-col gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              <li>
                {t.rich("howToGrade.again", { term: (c) => <strong>{c}</strong> })}
              </li>
              <li>
                {t.rich("howToGrade.hard", { term: (c) => <strong>{c}</strong> })}
              </li>
              <li>
                {t.rich("howToGrade.good", { term: (c) => <strong>{c}</strong> })}
              </li>
              <li>
                {t.rich("howToGrade.easy", { term: (c) => <strong>{c}</strong> })}
              </li>
            </ul>
            <p className={`mt-2 ${mutedTextXs}`}>
              {t("howToGrade.honestGradeNote")}
            </p>
          </section>

          {/* Audio section */}
          <section aria-labelledby="modal-audio-heading">
            <h3
              id="modal-audio-heading"
              className={cn("mb-2", sectionLabel)}
            >
              {t("addingSound.heading")}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {t("addingSound.body")}
            </p>
            <Link
              href="/settings#audio-heading"
              onClick={dismiss}
              className="mt-2 inline-flex min-h-[36px] items-center rounded-lg border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t("addingSound.openAudioSettings")}
            </Link>
          </section>

          {/* Guest storage section - only for signed-out users */}
          {isGuest && (
            <section
              aria-labelledby="modal-storage-heading"
              className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h3
                id="modal-storage-heading"
                className={cn("mb-1", sectionLabel)}
              >
                {t("guestStorage.heading")}
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                {t("guestStorage.body")}
              </p>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={dismiss}
            className="min-h-[44px] rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
          >
            {t("getStarted")}
          </button>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
