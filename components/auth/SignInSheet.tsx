"use client";

/**
 * SignInSheet - bottom sheet on mobile, centred modal on desktop.
 *
 * Replaces the old `SignInPicker` dropdown in AuthButton and consolidates
 * every sign-in entry point to a single surface (#1669).
 *
 * Accessibility contract (mirrors FirstVisitOnboardingModal):
 * - Rendered via createPortal outside #app-root.
 * - While open, #app-root receives `inert` and `aria-hidden` so screen-reader
 *   virtual cursor cannot reach background content.
 * - Focus is moved into the sheet on open (close button) and restored on close.
 * - Tab/Shift+Tab cycle is trapped inside the dialog.
 * - Escape key closes the sheet.
 * - Provider logos are decorative (aria-hidden); each button carries its
 *   visible text label so there is no Label-in-Name mismatch.
 * - Mobile: padding-bottom honours env(safe-area-inset-bottom) (mirrors
 *   BottomTabBar).
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { signIn } from "@/lib/auth/actions";
import type { AuthProvider } from "@/lib/auth/types";
import { colStack } from "@/lib/utils/class-names";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SignInSheet({ open, onClose }: Props) {
  const t = useTranslations("auth");
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Guard against SSR - createPortal requires a DOM.
  useEffect(() => {
    setMounted(true);
  }, []);

  // When the sheet opens:
  //   1. Capture the currently focused element for focus restore on close.
  //   2. Move focus to the close button.
  //   3. Mark #app-root inert + aria-hidden.
  useEffect(() => {
    if (!open) return;

    prevFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const appRoot = document.getElementById("app-root");
    if (appRoot) {
      appRoot.setAttribute("inert", "");
      appRoot.setAttribute("aria-hidden", "true");
    }

    return () => {
      if (appRoot) {
        appRoot.removeAttribute("inert");
        appRoot.removeAttribute("aria-hidden");
      }
    };
  }, [open]);

  const handleClose = useCallback(() => {
    onClose();
    if (prevFocusRef.current && prevFocusRef.current !== document.body) {
      prevFocusRef.current.focus();
    }
  }, [onClose]);

  // Lock scroll + Escape to close + focus trap.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }

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
  }, [open, handleClose]);

  function handleSignIn(provider: AuthProvider) {
    startTransition(() => signIn(provider));
    // Do not close the sheet here - the server action triggers a redirect.
    // Closing prematurely removes the inert guard before the navigation completes.
  }

  if (!mounted || !open) return null;

  return createPortal(
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/60"
      aria-hidden="false"
      // Click on the backdrop (outside the dialog) closes the sheet.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Dialog panel - bottom sheet on mobile, centred card on desktop */}
      <dialog
        ref={dialogRef}
        open
        aria-modal="true"
        aria-labelledby="sign-in-sheet-heading"
        className={[
          "relative w-full rounded-t-2xl sm:rounded-2xl",
          "max-w-md bg-background p-0 shadow-xl focus:outline-none",
          // Mobile: safe-area-inset-bottom so the sheet clears the home bar.
          "pb-[env(safe-area-inset-bottom)]",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <h2
            id="sign-in-sheet-heading"
            className="text-base font-semibold text-foreground"
          >
            {t("signInSheet.heading")}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label={t("signInSheet.closeAriaLabel")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <span aria-hidden="true">&#x2715;</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 px-6 py-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {t("signInSheet.body")}
          </p>

          {/* Provider buttons */}
          <div className={colStack}>
            <button
              type="button"
              onClick={() => handleSignIn("github")}
              disabled={isPending}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-200 bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {isPending ? t("signingIn") : t("continueWithGitHub")}
            </button>
            <button
              type="button"
              onClick={() => handleSignIn("google")}
              disabled={isPending}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-200 bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {isPending ? t("signingIn") : t("continueWithGoogle")}
            </button>
          </div>

        </div>
      </dialog>
    </div>,
    document.body,
  );
}
