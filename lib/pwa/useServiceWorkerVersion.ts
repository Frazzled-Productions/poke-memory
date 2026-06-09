/**
 * Hook that queries the controlling service worker for its baked-in version
 * string (#1826).
 *
 * The version is injected into the SW bundle at build time by
 * `scripts/build-sw.mjs` via esbuild's `define` block (`__SW_VERSION__`). An
 * old controlling worker therefore always reports its own frozen version, not
 * the new app version - making SW/app mismatches detectable.
 *
 * Protocol:
 *   Client posts `{ type: "GET_SW_VERSION" }` to `navigator.serviceWorker.controller`
 *   via a `MessageChannel`. The SW replies on `port1` with
 *   `{ type: "SW_VERSION", version: string }`. A 2-second timeout guards
 *   against a non-responsive controller; the fallback result is `null`.
 *
 * Returns:
 *   - `{ status: "loading" }` while the query is in flight.
 *   - `{ status: "no-controller" }` when no controller is active (first load,
 *     fresh install, or non-production env).
 *   - `{ status: "ready", version: string }` on success.
 *   - `{ status: "timeout" }` when the controller does not reply within 2 s.
 */
"use client";

import { useEffect, useState } from "react";

export type SwVersionState =
  | { status: "loading" }
  | { status: "no-controller" }
  | { status: "ready"; version: string }
  | { status: "timeout" };

const QUERY_TIMEOUT_MS = 2000;

export function useServiceWorkerVersion(): SwVersionState {
  const [state, setState] = useState<SwVersionState>({ status: "loading" });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      setState({ status: "no-controller" });
      return;
    }

    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      setState({ status: "no-controller" });
      return;
    }

    let settled = false;

    const { port1, port2 } = new MessageChannel();

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      port1.close();
      setState({ status: "timeout" });
    }, QUERY_TIMEOUT_MS);

    port1.onmessage = (event: MessageEvent<{ type?: string; version?: string }>) => {
      if (settled) return;
      if (
        event.data &&
        event.data.type === "SW_VERSION" &&
        typeof event.data.version === "string"
      ) {
        settled = true;
        clearTimeout(timer);
        port1.close();
        setState({ status: "ready", version: event.data.version });
      }
    };

    controller.postMessage({ type: "GET_SW_VERSION" }, [port2]);

    return () => {
      settled = true;
      clearTimeout(timer);
      port1.close();
    };
  }, []);

  return state;
}
