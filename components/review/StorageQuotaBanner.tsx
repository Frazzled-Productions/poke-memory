"use client";

import { useTranslations } from "next-intl";

type Props = {
  onDismiss: () => void;
};

export function StorageQuotaBanner({ onDismiss }: Props) {
  const t = useTranslations("review");
  return (
    <div
      role="alert"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <span>{t("storageFullBanner")}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("storageFullDismiss")}
        className="shrink-0 rounded text-amber-600 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 dark:text-amber-400 dark:hover:text-amber-200"
      >
        ×
      </button>
    </div>
  );
}
