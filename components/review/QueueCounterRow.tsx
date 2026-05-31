"use client";

import { useTranslations } from "next-intl";

type Props = {
  newCount: number;
  learningCount: number;
  reviewCount: number;
};

export function QueueCounterRow({ newCount, learningCount, reviewCount }: Props) {
  const t = useTranslations("review.queue");
  return (
    <div className="flex justify-center gap-6 text-sm tabular-nums" role="status" aria-label={t("ariaLabel")}>
      <span>
        <span className="font-semibold text-blue-600 dark:text-blue-400">{newCount}</span>
        {" "}
        <span className="text-zinc-500 dark:text-zinc-400">{t("new")}</span>
      </span>
      <span>
        <span className="font-semibold text-red-600 dark:text-red-400">{learningCount}</span>
        {" "}
        <span className="text-zinc-500 dark:text-zinc-400">{t("learning")}</span>
      </span>
      <span>
        <span className="font-semibold text-green-600 dark:text-green-400">{reviewCount}</span>
        {" "}
        <span className="text-zinc-500 dark:text-zinc-400">{t("review")}</span>
      </span>
    </div>
  );
}
