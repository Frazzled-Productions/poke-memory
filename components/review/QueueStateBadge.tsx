"use client";

import { useTranslations } from "next-intl";
import type { ReviewState } from "@/lib/srs/scheduler";
import { InfoButton } from "@/components/ui/InfoButton";

type QueueState = "new" | "learning" | "review";

function deriveQueueState(
  state: ReviewState,
  forceCardsGraduated: boolean,
): QueueState {
  // When forceCardsGraduated is active, the card is treated as graduated —
  // suppress the "Learning" badge so QA developers see the correct state.
  if (!forceCardsGraduated && state.learningStep !== null) return "learning";
  if (state.lastReview === null) return "new";
  return "review";
}

const COLOURS: Record<QueueState, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  learning: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  review: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

type Props = {
  state: ReviewState;
  forceCardsGraduated?: boolean;
};

export function QueueStateBadge({ state, forceCardsGraduated = false }: Props) {
  const t = useTranslations("review.queue");
  const queue = deriveQueueState(state, forceCardsGraduated);
  const label = t(queue);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="status"
        aria-label={`Card queue state: ${label}`}
        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${COLOURS[queue]}`}
      >
        {label}
      </span>
      <InfoButton
        ariaLabel={t("infoAriaLabel")}
        panelId="queue-state-info"
        panelContent={
          <ul className="space-y-1.5 list-none m-0 p-0">
            <li>{t("infoNew")}</li>
            <li>{t("infoLearning")}</li>
            <li>{t("infoReview")}</li>
          </ul>
        }
        panelClassName="right-0"
      />
    </span>
  );
}
