"use client";

import { useEffect, useRef } from "react";
import { dialogPanel } from "@/lib/utils/class-names";

export type ReenableChoice = "reuse" | "fresh";

interface Props {
  open: boolean;
  cardTypeName: string;
  onClose: () => void;
  onChoose: (choice: ReenableChoice) => void;
}

/**
 * Shown when a user re-enables a card type that was previously disabled.
 * Offers two options:
 *   - "Reuse my saved progress" (default / recommended)
 *   - "Start fresh" (destructive: resets those cards to initial state)
 */
export function ReenableCardTypeDialog({ open, cardTypeName, onClose, onChoose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Give focus to the primary (reuse) button when the dialog opens.
  const reuseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      dialog.showModal();
      // Defer so the browser can process showModal before moving focus.
      requestAnimationFrame(() => {
        reuseButtonRef.current?.focus();
      });
    } else {
      dialog.close();
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

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="reenable-dialog-title"
      aria-describedby="reenable-dialog-desc"
      className={dialogPanel}
    >
      <h2 id="reenable-dialog-title" className="text-lg font-semibold text-foreground">
        Re-enable {cardTypeName}?
      </h2>
      <p id="reenable-dialog-desc" className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        You have saved progress for {cardTypeName}. Would you like to pick up where you left off, or start from scratch?
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onChoose("fresh")}
          className="min-h-[44px] rounded-lg border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
        >
          Start fresh
        </button>
        <button
          ref={reuseButtonRef}
          type="button"
          onClick={() => onChoose("reuse")}
          className="min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Reuse my saved progress
        </button>
      </div>
    </dialog>
  );
}
