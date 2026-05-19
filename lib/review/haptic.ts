/**
 * Haptic feedback on card grade commit.
 *
 * Two progressive-enhancement paths:
 *
 * 1. Vibration API (Android / Chromium) — `navigator.vibrate(ms)`.
 *    Feature-detected; no-ops when absent.
 *
 * 2. iOS switch technique (iOS 17.4+) — toggling an `<input type="checkbox"
 *    switch>` via a programmatic label click triggers a system haptic in Mobile
 *    Safari. The hidden switch element is rendered by `useHapticSwitch` and
 *    passed in as `triggerIosHaptic`.
 *
 * Both paths are skipped when the user has requested reduced motion
 * (`prefers-reduced-motion: reduce`), consistent with existing animation
 * gating in the codebase.
 */

import type { Grade } from "@/lib/review/session";

/**
 * Returns true when the `switch` attribute on `<input type="checkbox">` is
 * recognised by the current browser (iOS Safari 17.4+).
 *
 * Pure synchronous feature-detect — safe to call in any browser context.
 */
export function supportsSwitchHaptic(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.createElement("input");
  el.setAttribute("type", "checkbox");
  el.setAttribute("switch", "");
  // The attribute is reflected as a boolean property only when supported.
  return "switch" in el;
}

/**
 * Returns true when the Vibration API is available.
 */
export function supportsVibration(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/**
 * Returns true when the user has requested reduced motion.
 * Safe to call during SSR (returns false — no preference known).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Vibration durations (ms) per grade, for the Vibration API path.
 *
 * `Again` gets a double-pulse to signal the regression more clearly.
 * `Hard` gets a moderate single pulse.
 * `Good` / `Easy` get a short, light pulse.
 */
const VIBRATION_PATTERN: Record<Grade, number | number[]> = {
  1: [30, 60, 30], // Again — double pulse
  2: 40,           // Hard — moderate single
  4: 20,           // Good — light single
  5: 15,           // Easy — lightest single
};

/**
 * Fire haptic feedback for a given grade.
 *
 * @param grade       The grade value (1 / 2 / 4 / 5).
 * @param triggerIos  Callback that performs the iOS switch toggle. Pass the
 *                    return value of `useHapticSwitch` — or `null` when the
 *                    hook is not yet mounted.
 */
export function triggerHaptic(
  grade: Grade,
  triggerIos: (() => void) | null,
): void {
  if (prefersReducedMotion()) return;

  // Prefer the Vibration API when available — works on Android / Chromium.
  if (supportsVibration()) {
    navigator.vibrate(VIBRATION_PATTERN[grade]);
    return;
  }

  // Fall back to the iOS switch technique.
  triggerIos?.();
}
