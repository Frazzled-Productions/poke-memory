"use client";

import { useEffect, useRef } from "react";
import { Serwist } from "@serwist/window";
import { isSessionActive } from "@/lib/review/sessionActive";

/**
 * Registers the Poké Memory service worker and silently activates new builds
 * at safe moments.
 *
 * The service worker is built and served by `@serwist/turbopack` at
 * `/sw/sw.js` (see `app/sw/[path]/route.ts`). Once registered it precaches the
 * app shell and runtime-caches sprites, so an installed PWA works offline for
 * a practice session.
 *
 * Update handling (silent-activate, #1162) - the classic PWA footgun is a
 * stale cache. The service worker is built with `skipWaiting: false`, so a
 * freshly deployed worker installs but stays in the `waiting` state. The
 * previous version of this component rendered a "refresh to update" banner
 * that competed with the "What's new" pill in the nav and interrupted the
 * user at a moment they did not ask for. It also overlapped with the
 * existing version pill (`WhatsNewIndicator`).
 *
 * The new flow:
 *
 *   1. When a waiting worker is detected (either via the `waiting` event or
 *      via a re-probe of `getRegistration()` on mount), arm a
 *      `visibilitychange` handler.
 *   2. On `visibilitychange → hidden`, if (a) no review session is mounted
 *      and (b) only this client window is open (the SW double-checks via
 *      `clients.matchAll` before honouring SKIP_WAITING), post SKIP_WAITING.
 *      Otherwise the listener stays armed for the next opportunity.
 *   3. The new worker activates while the tab is hidden; the
 *      `controllerchange` handler reloads it the next time the user brings
 *      it back, fresh from the new bundle.
 *
 * Periodic update check (#1164, tightened in #1750) - `registration.update()`
 * is a cheap no-op when no new SW exists, so we call it on
 * `visibilitychange → visible` after the tab has been hidden for at least
 * 90 s, and on a 1-hour interval for tabs that never hide. This shrinks the
 * discovery window for a fresh deploy from the browser default (~24 h) to
 * well under two minutes for any active tab.
 *
 * Registration is skipped outside production builds so a `next dev` session
 * is never shadowed by a cached shell.
 */
export function ServiceWorkerProvider() {
  const serwistRef = useRef<Serwist | null>(null);
  // Guards the single post-activation reload so an update can't loop reloads.
  const reloadedRef = useRef(false);
  // Set when the silent activator posts SKIP_WAITING. Only then does the
  // resulting `controllerchange` warrant a reload - a `controllerchange` from
  // a first-ever install (via `clientsClaim`) must not reload the page.
  const updateAcceptedRef = useRef(false);
  // True when a SW is in the `waiting` state and the silent activator should
  // post SKIP_WAITING at the next safe visibility tick.
  const waitingRef = useRef(false);
  // Timestamp of the last visibility-triggered `registration.update()` call
  // so brief tab-switches do not produce a burst of update checks.
  const lastUpdateAtRef = useRef(0);
  // Timestamp the tab last went hidden, used to decide whether a returning
  // tab has been away long enough to warrant a periodic update check.
  const hiddenAtRef = useRef<number | null>(null);

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

    // A new worker has installed and is waiting - arm the silent activator.
    const onWaiting = () => {
      waitingRef.current = true;
    };
    serwist.addEventListener("waiting", onWaiting);

    // Re-probe on mount: the `waiting` event fires only once per waiting
    // worker, so a user who backgrounded the page after the event fired and
    // before this component remounted would otherwise never trip the
    // activator. Probing the registration directly closes that gap.
    void navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration?.waiting) waitingRef.current = true;
    });

    // A worker has taken control. Reload only when this is the result of the
    // silent activator posting SKIP_WAITING - `clientsClaim` also fires this
    // event on a first-ever install, which must not reload the page.
    // `reloadedRef` additionally guards against a reload loop.
    const onControllerChange = () => {
      if (reloadedRef.current || !updateAcceptedRef.current) return;
      reloadedRef.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Safe-moment activator. On `visibilitychange → hidden`, if a SW is
    // waiting and no review session is active, post SKIP_WAITING. The SW
    // double-checks `clients.matchAll().length <= 1` before honouring the
    // request so a co-open tab is not yanked while it is still in the
    // foreground (#1162 multi-tab gate). If the SW declines, this listener
    // stays armed for the next visibility tick.
    //
    // Periodic update check (#1164). On `visibilitychange → visible`, if the
    // tab was hidden for at least HIDDEN_FOR_UPDATE_CHECK_MS and we haven't
    // called `update()` in the last UPDATE_CHECK_THROTTLE_MS, ask the
    // registration to revalidate the SW script.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();

        if (!waitingRef.current) return;
        if (isSessionActive()) return;

        updateAcceptedRef.current = true;
        serwistRef.current?.messageSkipWaiting();
        return;
      }

      // Tab became visible.
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt === null) return;

      const hiddenForMs = Date.now() - hiddenAt;
      if (hiddenForMs < HIDDEN_FOR_UPDATE_CHECK_MS) return;

      const sinceLastUpdate = Date.now() - lastUpdateAtRef.current;
      if (sinceLastUpdate < UPDATE_CHECK_THROTTLE_MS) return;

      lastUpdateAtRef.current = Date.now();
      void serwistRef.current?.update();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Belt-and-braces periodic check for tabs that never hide (e.g. a desktop
    // tab pinned on a second monitor). `registration.update()` is a no-op
    // when no new SW exists, so the cost is a small HEAD request every 4
    // hours.
    const intervalId = window.setInterval(() => {
      lastUpdateAtRef.current = Date.now();
      void serwistRef.current?.update();
    }, BACKGROUND_UPDATE_INTERVAL_MS);

    void serwist.register();

    return () => {
      serwist.removeEventListener("waiting", onWaiting);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
}

/**
 * How long the tab must have been hidden before a visibilitychange→visible
 * triggers `registration.update()`. 90 s filters routine alt-tabs while still
 * catching a user returning from a notification, lock screen, or short
 * break - the original 5 min felt too slow for a mobile-first app. 30 s was
 * rejected as too aggressive on low-end devices.
 */
const HIDDEN_FOR_UPDATE_CHECK_MS = 90 * 1000;

/**
 * Minimum gap between two visibility-triggered `registration.update()`
 * calls. Kept at or above HIDDEN_FOR_UPDATE_CHECK_MS (2 min >= 90 s) so a
 * tab that flips hidden/visible repeatedly at the threshold boundary cannot
 * produce a burst of consecutive update() calls.
 *
 * INVARIANT: UPDATE_CHECK_THROTTLE_MS >= HIDDEN_FOR_UPDATE_CHECK_MS.
 */
const UPDATE_CHECK_THROTTLE_MS = 2 * 60 * 1000;

/**
 * Background `registration.update()` interval for tabs that never go hidden
 * (e.g. a pinned tab on a secondary display). 1 h is the community floor
 * (web.dev / Vite PWA recommendations) and costs only one ~1 KB conditional
 * GET per hour, down from the previous 4 h worst-case discovery window.
 */
const BACKGROUND_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
