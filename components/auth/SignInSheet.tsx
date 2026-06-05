"use client";

/**
 * SignInSheet - bottom sheet on mobile, centred modal on desktop.
 *
 * Replaces the old `SignInPicker` dropdown in AuthButton and consolidates
 * every sign-in entry point to a single surface (#1669).
 *
 * Now includes a username/password door (#1671) as a secondary "Quicker, but
 * limited" tier below a divider. The username door supports both sign-up and
 * sign-in via a mode toggle.
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
 * - Username form: labelled inputs with visible <label> elements; form element
 *   with a submit button so Enter submits.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { signIn, signUpWithUsername, signInWithUsername } from "@/lib/auth/actions";
import type { AuthProvider } from "@/lib/auth/types";
import { normaliseUsername, validateUsername, MIN_PASSWORD_LENGTH } from "@/lib/auth/username";
import { colStack } from "@/lib/utils/class-names";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Whether the username form is in sign-up or sign-in mode. */
type UsernameMode = "signup" | "signin";

export function SignInSheet({ open, onClose }: Props) {
  const t = useTranslations("auth");
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Username/password form state.
  const [usernameMode, setUsernameMode] = useState<UsernameMode>("signup");
  const [usernameValue, setUsernameValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Guard against SSR - createPortal requires a DOM.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset form state when sheet closes.
  useEffect(() => {
    if (!open) {
      setUsernameValue("");
      setPasswordValue("");
      setFormError(null);
      setUsernameMode("signup");
    }
  }, [open]);

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
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  async function handleUsernameSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const normalised = normaliseUsername(usernameValue);
    const usernameErr = validateUsername(normalised);
    if (usernameErr) {
      setFormError(
        usernameErr === "username_too_short"
          ? t("signInSheet.username.errorUsernameTooShort")
          : usernameErr === "username_too_long"
            ? t("signInSheet.username.errorUsernameTooLong")
            : t("signInSheet.username.errorUsernameInvalidChars"),
      );
      return;
    }

    if (passwordValue.length < MIN_PASSWORD_LENGTH) {
      setFormError(t("signInSheet.username.errorPasswordTooShort"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result =
        usernameMode === "signup"
          ? await signUpWithUsername(normalised, passwordValue)
          : await signInWithUsername(normalised, passwordValue);

      if (!result.ok) {
        const errKey = result.error;
        setFormError(
          errKey === "username_taken"
            ? t("signInSheet.username.errorUsernameTaken")
            : errKey === "invalid_credentials"
              ? t("signInSheet.username.errorInvalidCredentials")
              : errKey === "password_too_short"
                ? t("signInSheet.username.errorPasswordTooShort")
                : t("signInSheet.username.errorSignupFailed"),
        );
      } else {
        // Success - the session is now set. Close the sheet; the page will
        // re-render with the authenticated state via onAuthStateChange.
        handleClose();
      }
    } catch {
      setFormError(t("signInSheet.username.errorSignupFailed"));
    } finally {
      setIsSubmitting(false);
    }
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

          {/* Social provider tier */}
          <div className={colStack}>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t("signInSheet.socialHeading")}
            </p>
            <button
              type="button"
              onClick={() => handleSignIn("github")}
              disabled={isPending || isSubmitting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-200 bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {isPending ? t("signingIn") : t("continueWithGitHub")}
            </button>
            <button
              type="button"
              onClick={() => handleSignIn("google")}
              disabled={isPending || isSubmitting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-zinc-200 bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {isPending ? t("signingIn") : t("continueWithGoogle")}
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {t("signInSheet.usernameDivider")}
            </span>
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
          </div>

          {/* Username/password tier */}
          <div className={colStack}>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t("signInSheet.usernameHeading")}
            </p>

            {/* Warnings - shown only in sign-up mode */}
            {usernameMode === "signup" && (
              <div className={colStack}>
                <p
                  role="note"
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {t("signInSheet.username.warningNoReset")}
                </p>
                <p
                  role="note"
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {t("signInSheet.username.warningNoRealName")}
                </p>
              </div>
            )}

            {/* Form */}
            <form
              onSubmit={handleUsernameSubmit}
              noValidate
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="username-input"
                  className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {t("signInSheet.username.usernameLabel")}
                </label>
                <input
                  id="username-input"
                  type="text"
                  name="username"
                  autoComplete="username"
                  placeholder={t("signInSheet.username.usernamePlaceholder")}
                  value={usernameValue}
                  onChange={(e) => setUsernameValue(e.target.value)}
                  disabled={isSubmitting || isPending}
                  className="min-h-[44px] rounded-lg border border-zinc-200 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-foreground disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:placeholder:text-zinc-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="password-input"
                  className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {t("signInSheet.username.passwordLabel")}
                </label>
                <input
                  id="password-input"
                  type="password"
                  name="password"
                  autoComplete={
                    usernameMode === "signup"
                      ? "new-password"
                      : "current-password"
                  }
                  placeholder={t("signInSheet.username.passwordPlaceholder")}
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
                  disabled={isSubmitting || isPending}
                  className="min-h-[44px] rounded-lg border border-zinc-200 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-foreground disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:placeholder:text-zinc-500"
                />
              </div>

              {/* Inline error */}
              {formError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting || isPending}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting
                  ? t("signInSheet.username.submitting")
                  : usernameMode === "signup"
                    ? t("signInSheet.username.submitSignUp")
                    : t("signInSheet.username.submitSignIn")}
              </button>
            </form>

            {/* Mode toggle */}
            <button
              type="button"
              onClick={() => {
                setUsernameMode((m) => (m === "signup" ? "signin" : "signup"));
                setFormError(null);
              }}
              disabled={isSubmitting || isPending}
              className="text-xs text-zinc-500 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-60 dark:text-zinc-400"
            >
              {usernameMode === "signup"
                ? t("signInSheet.signInInstead")
                : t("signInSheet.signUpInstead")}
            </button>
          </div>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}
