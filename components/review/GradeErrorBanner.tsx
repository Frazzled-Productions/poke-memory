"use client";

import { useTranslations } from "next-intl";

type Props = {
  message: string;
  onDismiss: () => void;
};

export function GradeErrorBanner({ message, onDismiss }: Props) {
  const t = useTranslations("practice");
  return (
    <div
      role="alert"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismissError")}
        className="shrink-0 rounded text-red-600 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 dark:text-red-400 dark:hover:text-red-200"
      >
        ×
      </button>
    </div>
  );
}
