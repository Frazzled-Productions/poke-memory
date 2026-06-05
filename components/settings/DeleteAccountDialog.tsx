"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { dialogPanel, mutedText } from "@/lib/utils/class-names";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/**
 * Type-to-confirm modal for the irreversible "Delete account" action. Modelled
 * on ResetProgressDialog, but the confirmation word is DELETE and the copy
 * makes clear this erases the account identity itself - not just progress.
 *
 * There is no PITR (#298), so deletion is genuinely unrecoverable; the
 * type-to-confirm gate is the deliberate friction.
 */
export function DeleteAccountDialog({ open, onClose, onConfirm }: Props) {
  const t = useTranslations("settings.deleteAccount");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
      setValue("");
      setError(null);
    }
  }, [open]);

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

  async function handleConfirm() {
    if (value !== "DELETE" || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-account-dialog-title"
      aria-describedby="delete-account-dialog-desc"
      className={dialogPanel}
    >
      <h2
        id="delete-account-dialog-title"
        className="text-lg font-semibold text-foreground"
      >
        Delete your account?
      </h2>
      <p
        id="delete-account-dialog-desc"
        className={`mt-2 max-w-sm ${mutedText}`}
      >
        This permanently erases your account and all of its data (review
        history, streaks, settings, and your sign-in identity) from the cloud
        and this device. It cannot be undone. Type{" "}
        <strong className="text-foreground">DELETE</strong> to confirm.
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type DELETE to confirm"
        aria-label={t("inputAriaLabel")}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={pending}
        className="mt-4 w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 dark:border-zinc-700"
      />
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={value !== "DELETE" || pending}
          className="min-h-[44px] rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-red-600 dark:hover:bg-red-500"
        >
          {pending ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </dialog>
  );
}
