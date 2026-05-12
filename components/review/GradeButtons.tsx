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

const GRADE_OPTIONS: GradeOption[] = [
  {
    grade: 1,
    label: "Again",
    className:
      "bg-red-100 text-red-800 hover:bg-red-200 focus-visible:ring-red-400 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50",
  },
  {
    grade: 2,
    label: "Hard",
    className:
      "bg-amber-100 text-amber-800 hover:bg-amber-200 focus-visible:ring-amber-400 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50",
  },
  {
    grade: 4,
    label: "Good",
    className:
      "bg-green-100 text-green-800 hover:bg-green-200 focus-visible:ring-green-400 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50",
  },
  {
    grade: 5,
    label: "Easy",
    className:
      "bg-blue-100 text-blue-800 hover:bg-blue-200 focus-visible:ring-blue-400 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50",
  },
];

export function GradeButtons({ onGrade, disabled = false, previews }: Props) {
  return (
    <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="Grade your answer">
      {GRADE_OPTIONS.map(({ grade, label, className }) => (
        <button
          key={grade}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(grade)}
          className={[
            "min-h-[44px] min-w-[80px] rounded-lg px-5 py-2",
            "text-sm font-semibold tracking-wide",
            "transition-colors duration-150",
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
