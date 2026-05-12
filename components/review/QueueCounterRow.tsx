"use client";

type Props = {
  newCount: number;
  learningCount: number;
  reviewCount: number;
};

export function QueueCounterRow({ newCount, learningCount, reviewCount }: Props) {
  return (
    <div className="flex justify-center gap-6 text-sm tabular-nums" role="status" aria-label="Queue counts">
      <span>
        <span className="font-semibold text-blue-600 dark:text-blue-400">{newCount}</span>
        {" "}
        <span className="text-zinc-500 dark:text-zinc-400">New</span>
      </span>
      <span>
        <span className="font-semibold text-red-600 dark:text-red-400">{learningCount}</span>
        {" "}
        <span className="text-zinc-500 dark:text-zinc-400">Learning</span>
      </span>
      <span>
        <span className="font-semibold text-green-600 dark:text-green-400">{reviewCount}</span>
        {" "}
        <span className="text-zinc-500 dark:text-zinc-400">Review</span>
      </span>
    </div>
  );
}
