"use client";

import type { Grade } from "@/lib/review/session";

type Props = {
  onGrade: (grade: Grade) => void;
  disabled?: boolean;
  previews?: Partial<Record<Grade, string>>;
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
      "bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-400",
  },
  {
    grade: 2,
    label: "Hard",
    className:
      "bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-400",
  },
  {
    grade: 4,
    label: "Good",
    className:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-400",
  },
  {
    grade: 5,
    label: "Easy",
    className:
      "bg-sky-500 text-white hover:bg-sky-600 focus-visible:ring-sky-400",
  },
];

export function GradeButtons({ onGrade, disabled = false, previews }: Props) {
  return (
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
          onClick={() => onGrade(grade)}
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
  );
}
