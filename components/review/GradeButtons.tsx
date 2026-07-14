"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Grade } from "@/lib/review/session";
import { triggerHaptic } from "@/lib/review/haptic";
import { useHapticSwitch } from "@/components/review/useHapticSwitch";
import { sectionHeadingSm } from "@/lib/utils/class-names";

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

export function KeyboardShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const t = useTranslations("practice");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut rows shown in the help overlay. Key `3` is listed alongside
  // `4` as an alias for Good, matching the common 1/2/3/4 muscle memory from other
  // SRS apps - the keydown handler in ReviewSession accepts both.
  const SHORTCUT_ROWS: { keys: string; action: string }[] = [
    { keys: "Space / Enter", action: t("keyboardShortcuts.revealCard") },
    { keys: "1", action: t("keyboardShortcuts.gradeAgain") },
    { keys: "2", action: t("keyboardShortcuts.gradeHard") },
    { keys: "3 / 4", action: t("keyboardShortcuts.gradeGood") },
    { keys: "5", action: t("keyboardShortcuts.gradeEasy") },
    { keys: "?", action: t("keyboardShortcuts.showOverlay") },
    { keys: "Esc", action: t("keyboardShortcuts.closeOverlay") },
  ];

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
        aria-label={t("keyboardShortcuts.title")}
        // Stop click bubbling so clicking inside the panel does not close it.
        onClick={(e) => e.stopPropagation()}
        className="relative mx-4 w-full max-w-sm rounded-2xl bg-surface-raised p-6 shadow-xl border border-[var(--theme-secondary)]"
      >
        <button
          type="button"
          aria-label={t("keyboardShortcuts.closeAriaLabel")}
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:text-zinc-200"
        >
          <span aria-hidden="true" className="block text-lg leading-none">
            &#x2715;
          </span>
        </button>

        <h2 className={`mb-4 ${sectionHeadingSm}`}>
          {t("keyboardShortcuts.title")}
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
          {t("keyboardShortcuts.inactiveNote")}
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
  const t = useTranslations("practice");

  // Strong saturated fills + a neutral outline ring + drop-shadow so the
  // buttons always read clearly against any mascot-tinted backdrop. Without
  // the ring + shadow, e.g. a pale-blue Snorlax card desaturates the Sky-Easy
  // button and a cream Pikachu card hides the Amber-Hard button.
  const GRADE_OPTIONS: GradeOption[] = [
    {
      grade: 1,
      label: t("again"),
      className:
        "bg-red-500 text-white [@media(hover:hover)]:hover:bg-red-600 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-red-400",
    },
    {
      grade: 2,
      label: t("hard"),
      className:
        "bg-amber-500 text-white [@media(hover:hover)]:hover:bg-amber-600 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-amber-400",
    },
    {
      grade: 4,
      label: t("good"),
      className:
        "bg-emerald-600 text-white [@media(hover:hover)]:hover:bg-emerald-700 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-emerald-400",
    },
    {
      grade: 5,
      label: t("easy"),
      className:
        "bg-sky-500 text-white [@media(hover:hover)]:hover:bg-sky-600 [@media(hover:hover)]:hover:shadow-lg focus-visible:ring-sky-400",
    },
  ];

  // Local open/close state, used when the parent does not provide controlled props.
  const [showShortcutsLocal, setShowShortcutsLocal] = useState(false);

  // iOS haptic switch - hidden off-screen element toggled to trigger a system
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
      {/* Grade buttons group - role="group" scopes the accessible name to the
          four grade buttons only. The `?` hint button is a sibling outside this
          group so screen readers do not announce it as part of the grading action. */}
      <div className="relative">
        <div
          // grid-cols-4 on mobile guarantees all four buttons share one row at
          // any viewport >= 320 px - the flex-wrap layout previously bumped
          // Easy to a second line at 402 px (iPhone 17 Pro) because the
          // per-button `min-w-[80px]` plus gaps overshot the available width
          // by ~10 px. The flex fallback at sm+ keeps the tablet/desktop
          // layout untouched.
          className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-3 rounded-xl bg-surface-raised p-2 sm:p-3 shadow-sm border border-[var(--theme-secondary)]"
          role="group"
          aria-label={t("gradeYourAnswer")}
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
                // min-w lifted off on mobile so the grid-cols-4 layout above
                // can shrink each button to 1/4 of the row instead of forcing
                // a wrap. sm+ restores the 80 px floor that the wrap layout
                // expects on tablet/desktop.
                "min-h-[44px] min-w-0 sm:min-w-[80px] rounded-lg px-3 sm:px-5 py-2",
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

        {/* Keyboard shortcut hint - a sibling of the grade group, not inside it,
            so it is not announced as part of "Grade your answer". Positioned
            absolutely relative to the outer wrapper. Hidden on small viewports. */}
        <button
          type="button"
          aria-label={t("showKeyboardShortcuts")}
          onClick={handleOpen}
          className="absolute -top-3 -right-3 hidden sm:flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-500 shadow-sm [@media(hover:hover)]:hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:bg-zinc-800 dark:text-zinc-400 [@media(hover:hover)]:dark:hover:bg-zinc-700"
        >
          ?
        </button>
      </div>

      {/* Render the overlay only in uncontrolled mode. When the parent
          provides showShortcuts/onCloseShortcuts it owns the overlay and
          renders it at a higher level (e.g. so the `?` key works even
          before the card is revealed). */}
      {!isControlled && overlayOpen && <KeyboardShortcutsOverlay onClose={handleClose} />}

      {/* Hidden iOS haptic switch - toggling this element via a label click
          triggers a system haptic on iOS 17.4+ (Mobile Safari supports the
          `switch` attribute on checkboxes). Fully inert to AT and keyboard:
          aria-hidden, tabIndex={-1}, positioned off-screen. Rendered
          unconditionally so the label ref is always valid; the trigger function
          is only called when `supportsSwitchHaptic()` is true. */}
      {/* `switch` is an iOS-only non-standard attribute not yet in React's type
          definitions - cast through unknown to avoid the no-explicit-any rule. */}
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
