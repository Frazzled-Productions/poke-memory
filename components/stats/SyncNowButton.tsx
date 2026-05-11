"use client";

type Props = {
  syncState: "idle" | "syncing" | "success" | "error";
  errorMessage: string | null;
  onSync: () => void;
};

export function SyncNowButton({ syncState, errorMessage, onSync }: Props) {
  const isDisabled = syncState === "syncing" || syncState === "success";

  const baseClasses =
    "inline-flex items-center gap-2 min-h-[44px] rounded-lg px-6 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none";

  const stateClasses: Record<Props["syncState"], string> = {
    idle: "bg-foreground text-background hover:opacity-80 focus-visible:ring-foreground",
    syncing:
      "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 cursor-wait focus-visible:ring-zinc-400",
    success:
      "bg-emerald-500 text-white focus-visible:ring-emerald-500",
    error:
      "bg-red-500 text-white hover:opacity-80 focus-visible:ring-red-500",
  };

  const labels: Record<Props["syncState"], string> = {
    idle: "Sync now",
    syncing: "Syncing…",
    success: "All synced",
    error: "Sync failed — retry?",
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onSync}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={syncState === "syncing"}
        className={`${baseClasses} ${stateClasses[syncState]}`}
      >
        {syncState === "syncing" && (
          <div
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {labels[syncState]}
      </button>
      {syncState === "error" && errorMessage !== null && (
        <p className="text-xs text-red-500 dark:text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}
