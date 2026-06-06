"use client";
// lib/pokemon/SeedContext.tsx
// React context that exposes the async-loaded seed data to client components.
//
// Stage 1 of the async-seed-loading work (#1677 / #1604). This is additive
// infra only: no consumer migration yet. Wire <SeedProvider> into
// app/layout.tsx in Stage 2.
//
// Pattern mirrors lib/i18n/PokemonLocaleContext.tsx: a single provider
// registers the async load; consumers call useSeed() to read the result.
//
// Visible-error policy: if loadSeed() rejects, the error is surfaced via
// `error` and a `retry()` helper allows re-attempting the load.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { loadSeed } from "@/lib/pokemon/seed-async";
import type { SeedData } from "@/lib/pokemon/seed-async";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export type SeedContextValue = {
  /** The loaded seed, or null while loading or on error. */
  seed: SeedData | null;
  /** Any error thrown by loadSeed(), or null. */
  error: Error | null;
  /**
   * Re-invokes loadSeed(). Call after an error to retry the fetch.
   * Has no effect while a load is already in flight or if the seed is
   * already cached.
   */
  retry: () => void;
};

const SeedCtx = createContext<SeedContextValue>({
  seed: null,
  error: null,
  retry: () => undefined,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Fetches the async seed on mount and exposes it via context.
 *
 * Mount once, high in the tree (app/layout.tsx, Stage 2 work).
 * Do NOT use inside a deeply nested subtree - one provider per page tree.
 *
 * On fetch failure `error` is set and `retry()` re-attempts. On success
 * `seed` is set and subsequent `retry()` calls are no-ops (loadSeed caches
 * internally).
 */
export function SeedProvider({ children }: { children: React.ReactNode }) {
  const [seed, setSeed] = useState<SeedData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(false);

  const doLoad = useCallback(() => {
    loadSeed().then(
      (data) => {
        if (!mountedRef.current) return;
        setSeed(data);
        setError(null);
      },
      (err: unknown) => {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    doLoad();
    return () => {
      mountedRef.current = false;
    };
  }, [doLoad]);

  const retry = useCallback(() => {
    // Clear previous error so the UI can show a loading indicator again.
    setError(null);
    doLoad();
  }, [doLoad]);

  return (
    <SeedCtx.Provider value={{ seed, error, retry }}>
      {children}
    </SeedCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the current seed state from the nearest `<SeedProvider>`.
 *
 * `seed` is null until loadSeed() resolves. `error` is set if the fetch
 * failed. Call `retry()` to re-attempt after an error.
 *
 * Must be called inside a `<SeedProvider>` tree. Outside a provider the
 * defaults (seed: null, error: null, retry: no-op) are returned.
 */
export function useSeed(): SeedContextValue {
  return useContext(SeedCtx);
}
