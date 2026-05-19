"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Grade } from "@/lib/review/session";
import { triggerHaptic } from "@/lib/review/haptic";
import { useHapticSwitch } from "@/components/review/useHapticSwitch";

type Props = {
  onGrade: (grade: Grade) => void;
  disabled?: boolean;
  previews?: Partial<Record<Grade, string>>;
  /**
   * When provided together, the parent controls the shortcuts overlay open
   * state (e.g. so the `?` keyboard shortcut in ReviewSession can open it).
   * Leave both undefined to let GradeButtons manage its own open/close state.
   */
  showShortcuts?: boolean;
  onOpenShortcuts?: () => void;
  onCloseShortcuts?: () => void;
};

type GradeOption = {
  grade: Grade;
  label: string;
  className: string;
};

// Strong saturated fills + a neutral outline ring + drop-shadow so the
// buttons always read clearly against any mascot-tinted backdrop. Without
// the ring + shadow, e.g. a pale-blue Snorlax card desaturates the Sky-Easy
// button and a cream Pikachu card hides the Amber-Hard button.
const GRADE_OPTIONS: GradeOption[] = [
  {
    grade: 1,
    label: "Again",
    className:
      "bg-red-500 text-white [@media(hover:hover)]:hover:bg-red-600 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-red-400",
  },
  {
    grade: 2,
    label: "Hard",
    className:
      "bg-amber-500 text-white [@media(hover:hover)]:hover:bg-amber-600 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-amber-400",
  },
  {
    grade: 4,
    label: "Good",
    className:
      "bg-emerald-600 text-white [@media(hover:hover)]:hover:bg-emerald-700 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-emerald-400",
  },
  {
    grade: 5,
    label: "Easy",
    className:
      "bg-sky-500 text-white [@media(hover:hover)]:hover:bg-sky-600 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-sky-400",
  },
];

// Keyboard shortcut rows shown in the help overlay. Key `3` is listed alongside
// `4` as an alias for Good, matching the common 1/2/3/4 muscle memory from other
// SRS apps — the keydown handler in ReviewSession accepts both.
const SHORTCUT_ROWS: { keys: string; action: string }[] = [
  { keys: "Space / Enter", action: "Reveal card" },
  { keys: "1", action: "Grade: Again" },
  { keys: "2", action: "Grade: Hard" },
  { keys: "3 / 4", action: "Grade: Good" },
  { keys: "5", action: "Grade: Easy" },
  { keys: "?", action: "Show this overlay" },
  { keys: "Esc", action: "Close this overlay" },
];

export function KeyboardShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus the first focusable element inside the dialog when it opens, and
  // restore focus to the trigger when it closes.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstFocusable = dialog.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
  }, []);

  // Focus trap: keep Tab cycles inside the dialog while it is open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // Backdrop - click-away closes.
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        // Stop click bubbling so clicking inside the panel does not close it.
        onClick={(e) => e.stopPropagation()}
        className="relative mx-4 w-full max-w-sm rounded-2xl bg-surface-raised p-6 shadow-xl border border-[var(--theme-secondary)]"
      >
        <button
          type="button"
          aria-label="Close keyboard shortcuts overlay"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:text-zinc-200"
        >
          <span aria-hidden="true" className="block text-lg leading-none">
            &#x2715;
          </span>
        </button>

        <h2 className="mb-4 text-base font-semibold text-foreground">
          Keyboard shortcuts
        </h2>

        <table className="w-full text-sm">
          <tbody>
            {SHORTCUT_ROWS.map(({ keys, action }) => (
              <tr
                key={keys}
                className="border-b border-zinc-100 dark:border-zinc-800 last:border-0"
              >
                <td className="py-2 pr-4">
                  <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {keys}
                  </kbd>
                </td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">
                  {action}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
          Shortcuts are inactive while a text field is focused.
        </p>
      </div>
    </div>
  );
}

export function GradeButtons({
  onGrade,
  disabled = false,
  previews,
  showShortcuts: showShortcutsControlled,
  onOpenShortcuts,
  onCloseShortcuts,
}: Props) {
  // Local open/close state, used when the parent does not provide controlled props.
  const [showShortcutsLocal, setShowShortcutsLocal] = useState(false);

  // iOS haptic switch — hidden off-screen element toggled to trigger a system
  // haptic on iOS 17.4+ (Mobile Safari supports `<input switch>`). Fully inert
  // to keyboard and assistive tech via aria-hidden + tabIndex={-1}.
  const hapticSwitchId = useId();
  const { labelRef: hapticLabelRef, triggerIosHaptic } = useHapticSwitch();

  const isControlled = showShortcutsControlled !== undefined;
  const overlayOpen = isControlled ? showShortcutsControlled : showShortcutsLocal;

  const handleOpen = () => {
    if (isControlled) {
      onOpenShortcuts?.();
    } else {
      setShowShortcutsLocal(true);
    }
  };

  const handleClose = () => {
    if (isControlled) {
      onCloseShortcuts?.();
    } else {
      setShowShortcutsLocal(false);
    }
  };

  return (
    <>
      {/* Grade buttons group — role="group" scopes the accessible name to the
          four grade buttons only. The `?` hint button is a sibling outside this
          group so screen readers do not announce it as part of the grading action. */}
      <div className="relative">
        <div
          className="flex flex-wrap justify-center gap-3 rounded-xl bg-surface-raised p-3 shadow-sm border border-[var(--theme-secondary)]"
          role="group"
          aria-label="Grade your answer"
        >
          {GRADE_OPTIONS.map(({ grade, label, className }) => (
            <button
              key={grade}
              type="button"
              disabled={disabled}
              onClick={() => {
                triggerHaptic(grade, triggerIosHaptic);
                onGrade(grade);
              }}
              className={[
                "min-h-[44px] min-w-[80px] rounded-lg px-5 py-2",
                "text-sm font-semibold tracking-wide",
                // Always-on outline + shadow so buttons keep their edge against
                // any mascot-tinted card backdrop.
                "ring-1 ring-black/15 dark:ring-white/20",
                "shadow-md",
                "transition-all duration-150",
                "active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                className,
              ].join(" ")}
            >
              <span className="block leading-tight">{label}</span>
              {previews?.[grade] && (
                <span className="block text-xs font-normal opacity-70 mt-0.5 leading-none">
                  {previews[grade]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Keyboard shortcut hint — a sibling of the grade group, not inside it,
            so it is not announced as part of "Grade your answer". Positioned
            absolutely relative to the outer wrapper. Hidden on small viewports. */}
        <button
          type="button"
          aria-label="Show keyboard shortcuts"
          onClick={handleOpen}
          className="absolute -top-3 -right-3 hidden sm:flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500 shadow-sm hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          ?
        </button>
      </div>

      {/* Render the overlay only in uncontrolled mode. When the parent
          provides showShortcuts/onCloseShortcuts it owns the overlay and
          renders it at a higher level (e.g. so the `?` key works even
          before the card is revealed). */}
      {!isControlled && overlayOpen && <KeyboardShortcutsOverlay onClose={handleClose} />}

      {/* Hidden iOS haptic switch — toggling this element via a label click
          triggers a system haptic on iOS 17.4+ (Mobile Safari supports the
          `switch` attribute on checkboxes). Fully inert to AT and keyboard:
          aria-hidden, tabIndex={-1}, positioned off-screen. Rendered
          unconditionally so the label ref is always valid; the trigger function
          is only called when `supportsSwitchHaptic()` is true. */}
      {/* `switch` is an iOS-only non-standard attribute not yet in React's type
          definitions — cast through unknown to avoid the no-explicit-any rule. */}
      <input
        id={hapticSwitchId}
        type="checkbox"
        {...({ switch: "" } as unknown as React.InputHTMLAttributes<HTMLInputElement>)}
        aria-hidden="true"
        tabIndex={-1}
        readOnly
        className="absolute -left-[9999px] pointer-events-none opacity-0"
      />
      <label
        ref={hapticLabelRef}
        htmlFor={hapticSwitchId}
        aria-hidden="true"
        className="absolute -left-[9999px] pointer-events-none opacity-0"
      />
    </>
  );
}
