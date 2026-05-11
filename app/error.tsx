"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-800 dark:bg-red-950">
        <h2 className="mb-2 text-lg font-semibold text-red-800 dark:text-red-200">
          Something went wrong
        </h2>
        <p className="mb-6 text-sm text-red-600 dark:text-red-400">
          An unexpected error occurred. You can try again, or come back later.
        </p>
        {process.env.NODE_ENV === "development" && (
          <pre className="mb-6 overflow-auto rounded bg-red-100 p-3 text-left text-xs text-red-700 dark:bg-red-900 dark:text-red-300">
            {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
        )}
        <button
          onClick={reset}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
