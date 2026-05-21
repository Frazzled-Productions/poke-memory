"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState<boolean>(isOffline);

  useEffect(() => {
    function handleOnline() {
      setOffline(false);
    }
    function handleOffline() {
      setOffline(true);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (offline) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
        <div className="w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 px-6 py-8 text-center dark:border-amber-800 dark:bg-amber-950">
          <h2 className="mb-2 text-lg font-semibold text-amber-800 dark:text-amber-200">
            You&apos;re offline
          </h2>
          <p className="mb-6 text-sm text-amber-700 dark:text-amber-300">
            Some pages aren&apos;t available without a connection. Cards
            you&apos;ve seen before should still work.
          </p>
          {process.env.NODE_ENV === "development" && (
            <pre className="mb-6 overflow-auto rounded bg-amber-100 p-3 text-left text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              {error.message}
              {error.digest ? `\ndigest: ${error.digest}` : ""}
            </pre>
          )}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={reset}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600"
            >
              Try again
            </button>
            <Link
              href="/practice"
              className="rounded-lg border border-amber-600 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-300 dark:hover:bg-amber-900"
            >
              Go to practice
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
