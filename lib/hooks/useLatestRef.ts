"use client";

import { useRef } from "react";
import type { RefObject } from "react";

/**
 * Returns a ref whose `.current` is always in sync with `value`.
 *
 * A ref is created once on the first render and then `ref.current` is assigned
 * to `value` on every subsequent render — before any effects fire. This makes
 * the ref safe to read inside event-listener closures that are registered once
 * (empty-dependency `useEffect`) but need access to the latest props or state
 * without re-registering on every change.
 *
 * @example
 * ```ts
 * const clientRef = useLatestRef(client);
 * useEffect(() => {
 *   window.addEventListener("online", () => {
 *     const c = clientRef.current; // always the latest client
 *   });
 * }, []);
 * ```
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value);
  ref.current = value;
  return ref;
}
