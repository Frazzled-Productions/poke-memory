/**
 * DismissableBanner — a dismissable alert banner with colour variants.
 *
 * Encapsulates the `role="alert"` wrapper, message span, and dismiss button
 * so a11y or styling changes propagate from one place (DRY per AGENTS.md
 * "Single source of truth for shared concepts").
 *
 * Usage:
 *   <DismissableBanner
 *     variant="red"
 *     message={someMessage}
 *     dismissLabel={t("dismissError")}
 *     onDismiss={handleDismiss}
 *   />
 *
 * Consumers are responsible for translating dismissLabel — this component
 * accepts the already-translated string so each consumer can use its own
 * i18n namespace and key.
 */

"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Variant = "red" | "amber";

type Props = {
  /** Colour variant: "red" for errors, "amber" for warnings. */
  variant: Variant;
  /** The message text to display. */
  message: string;
  /** Translated accessible label for the dismiss button. */
  dismissLabel: string;
  /** Called when the user clicks the dismiss button. */
  onDismiss: () => void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRAPPER_CLASSES: Record<Variant, string> = {
  red: "flex w-full items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
  amber:
    "flex w-full items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

const BUTTON_CLASSES: Record<Variant, string> = {
  red: "shrink-0 rounded text-red-600 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 dark:text-red-400 dark:hover:text-red-200",
  amber:
    "shrink-0 rounded text-amber-600 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 dark:text-amber-400 dark:hover:text-amber-200",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DismissableBanner({ variant, message, dismissLabel, onDismiss }: Props) {
  return (
    <div role="alert" className={WRAPPER_CLASSES[variant]}>
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className={BUTTON_CLASSES[variant]}
      >
        ×
      </button>
    </div>
  );
}
