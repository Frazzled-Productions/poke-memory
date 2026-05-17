"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Serwist } from "@serwist/window";

/**
 * Registers the Poké Memory service worker and surfaces an in-app update
 * prompt.
 *
 * The service worker is built and served by `@serwist/turbopack` at
 * `/sw/sw.js` (see `app/sw/[path]/route.ts`). Once registered it precaches the
 * app shell and runtime-caches sprites, so an installed PWA works offline for
 * a practice session.
 *
 * Update handling — the classic PWA footgun is a stale cache. The service
 * worker is built with `skipWaiting: false`, so a freshly deployed worker
 * installs but stays in the `waiting` state until the user opts in. When that
 * happens this component renders a "refresh to update" banner. Pressing
 * Refresh posts `SKIP_WAITING` (via `messageSkipWaiting`), the new worker
 * activates and takes control, and the page reloads once on `controlling`.
 *
 * Registration is skipped outside production builds so a `next dev` session
 * is never shadowed by a cached shell.
 */
export function ServiceWorkerProvider() {
  const [updateReady, setUpdateReady] = useState(false);
  const serwistRef = useRef<Serwist | null>(null);
  // Guards the single post-activation reload so an update can't loop reloads.
  const reloadedRef = useRef(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    // esbuild bundles `app/sw.ts` as an ES module (`format: "esm"`), so the
    // worker must be registered with `type: "module"`.
    const serwist = new Serwist("/sw/sw.js", { scope: "/", type: "module" });
    serwistRef.current = serwist;

    // A new worker has installed and is waiting — offer the update.
    const onWaiting = () => setUpdateReady(true);
    serwist.addEventListener("waiting", onWaiting);

    // The new worker has taken control. Reload once so the page runs against
    // the fresh app shell. `controllerchange` also fires on the very first
    // registration; `reloadedRef` plus the `updateReady` gate keep that from
    // triggering an unwanted reload.
    const onControllerChange = () => {
      if (reloadedRef.current) return;
      reloadedRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void serwist.register();

    return () => {
      serwist.removeEventListener("waiting", onWaiting);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    // Tell the waiting worker to activate. `controllerchange` then fires and
    // reloads the page.
    serwistRef.current?.messageSkipWaiting();
  }, []);

  if (!updateReady) return null;

  return (
    <div
      role="alert"
      aria-label="App update available"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-[env(safe-area-inset-bottom)] flex w-full max-w-md items-center gap-3 rounded-t-xl border border-zinc-200 bg-zinc-50 px-4 py-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 sm:mb-3 sm:rounded-xl"
    >
      <div className="flex-1">
        <p className="text-sm font-semibold text-foreground">
          A new version is ready
        </p>
        <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          Refresh to get the latest version of Poké Memory.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setUpdateReady(false)}
          className="inline-flex min-h-[36px] items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Later
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex min-h-[36px] items-center rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
