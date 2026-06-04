"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { colStackLg, dialogPanel, mutedTextXs } from "@/lib/utils/class-names";

/** Valid feedback categories as accepted by POST /api/feedback (#1621). */
type FeedbackCategory = "bug" | "feature" | "other";

const MESSAGE_MAX_LENGTH = 2000;

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * FeedbackModal (#1622)
 *
 * A <dialog>-based modal that lets both guest and authenticated users send
 * bug reports and feature requests via POST /api/feedback.
 *
 * - Category selector (required): Bug report / Feature request / Other
 * - Message textarea: max 2000 chars with live character counter
 * - Submit button with in-flight loading state
 * - Success state: confirmation message replaces the form
 * - Error state: inline message with retry prompt (modal stays open)
 * - Captures window.location.pathname automatically as `page`
 * - Passes NEXT_PUBLIC_APP_VERSION as `appVersion`
 * - Cmd/Ctrl+Enter submits the form from the textarea
 * - Inline privacy notice per Children's Code Standard 3 and GDPR
 */
export function FeedbackModal({ open, onClose }: Props) {
  const t = useTranslations("settings.feedback");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  // Reset form state whenever the modal closes so it's clean on next open.
  useEffect(() => {
    if (!open) {
      setCategory("");
      setMessage("");
      setSubmitting(false);
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

  // Close on backdrop Escape key (native <dialog> cancel event).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleCancel(e: Event) {
      e.preventDefault();
      onClose();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (category === "" || message.trim().length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: message.slice(0, MESSAGE_MAX_LENGTH),
          page: window.location.pathname,
          appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? undefined,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(t("errorMessage"));
        setSubmitting(false);
      }
    } catch {
      setError(t("errorMessage"));
      setSubmitting(false);
    }
  }, [category, message, submitting, t]);

  // Cmd/Ctrl+Enter submits from within the textarea.
  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const charCount = message.length;
  const overLimit = charCount > MESSAGE_MAX_LENGTH;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="feedback-dialog-title"
      className={`${dialogPanel} w-full max-w-lg`}
    >
      {submitted ? (
        /* ── Success state ───────────────────────────────────────────────── */
        <div className={colStackLg}>
          <h2
            id="feedback-dialog-title"
            className="text-lg font-semibold text-foreground"
          >
            {t("successHeading")}
          </h2>
          <p className="text-sm text-foreground">{t("successBody")}</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              {t("close")}
            </button>
          </div>
        </div>
      ) : (
        /* ── Form state ──────────────────────────────────────────────────── */
        <div className={colStackLg}>
          <h2
            id="feedback-dialog-title"
            className="text-lg font-semibold text-foreground"
          >
            {t("dialogTitle")}
          </h2>

          {/* Category selector */}
          <div>
            <label
              htmlFor="feedback-category"
              className="block text-sm font-medium text-foreground"
            >
              {t("categoryLabel")}
            </label>
            <select
              id="feedback-category"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as FeedbackCategory | "")
              }
              disabled={submitting}
              required
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700"
            >
              <option value="" disabled>
                --
              </option>
              <option value="bug">{t("categoryBug")}</option>
              <option value="feature">{t("categoryFeature")}</option>
              <option value="other">{t("categoryOther")}</option>
            </select>
          </div>

          {/* Message textarea */}
          <div>
            <label
              htmlFor="feedback-message"
              className="block text-sm font-medium text-foreground"
            >
              {t("messageLabel")}
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              disabled={submitting}
              placeholder={t("messagePlaceholder")}
              rows={5}
              maxLength={MESSAGE_MAX_LENGTH}
              className="mt-2 w-full resize-y rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700"
            />
            {/* Character counter */}
            <p
              className={`mt-1 text-right ${overLimit ? "text-xs font-medium text-red-600 dark:text-red-400" : mutedTextXs}`}
              aria-live="polite"
              aria-atomic="true"
            >
              {t("characterCount", { count: charCount, max: MESSAGE_MAX_LENGTH })}
            </p>
          </div>

          {/* Privacy notice (mandatory per Children's Code Standard 3 / GDPR) */}
          <p
            className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200`}
            role="note"
          >
            {t("privacyNotice")}
          </p>

          {/* Inline error */}
          {error !== null && (
            <p
              role="alert"
              className="text-sm font-medium text-red-600 dark:text-red-400"
            >
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={category === "" || message.trim().length === 0 || overLimit || submitting}
              className="min-h-[44px] rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? t("submitting") : t("submit")}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
