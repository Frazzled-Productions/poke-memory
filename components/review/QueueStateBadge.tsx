import type { ReviewState } from "@/lib/srs/scheduler";

type QueueState = "new" | "learning" | "review";

function deriveQueueState(state: ReviewState): QueueState {
  if (state.learningStep !== null) return "learning";
  if (state.lastReview === null) return "new";
  return "review";
}

const LABELS: Record<QueueState, string> = {
  new: "New",
  learning: "Learning",
  review: "Review",
};

const COLOURS: Record<QueueState, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  learning: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  review: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

type Props = {
  state: ReviewState;
};

export function QueueStateBadge({ state }: Props) {
  const queue = deriveQueueState(state);
  const label = LABELS[queue];
  return (
    <span
      role="status"
      aria-label={`Card queue state: ${label}`}
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${COLOURS[queue]}`}
    >
      {label}
    </span>
  );
}
