/**
 * Runtime driver for the streak-protection tokens (#1227).
 *
 * Reads the current streak dates and protection state, runs one
 * `applyProtectionStep` pass for today, and persists any changes back to
 * `user_settings`. Idempotent across same-day calls — the earn-leg guard
 * (`lastEarnCheckDate`) and the spend-leg guard (yesterday already in
 * `spendDates`) both prevent double counting.
 *
 * Returns a small summary so callers can surface a UI signal (toast, log
 * line, debug output). Returns null (without throwing) when called on the
 * server or when no settings record exists yet. Storage operations inside the
 * normal path are not error-wrapped; callers in a `useEffect` should guard
 * with try/catch if robustness to storage errors is required.
 */

import { loadStreakData } from "./persistence";
import {
  applyProtectionStep,
  type ProtectionStepResult,
  type StreakProtection,
} from "./tokens";
import {
  loadSettings,
  saveSettings,
  hasStoredSettings,
} from "@/lib/settings/persistence";

export type RunProtectionResult = ProtectionStepResult | null;

/**
 * Run a single protection step for `today`. No-op on the server. Returns
 * `null` if the run could not be evaluated (SSR, etc.); otherwise returns
 * the step result. Persists changes when anything moved.
 *
 * To preserve the existing onboarding posture, the function will not create
 * a settings record on a fresh device that has none yet (`hasStoredSettings`
 * is false). A brand-new user has nothing to protect.
 */
export function runStreakProtection(today: string): RunProtectionResult {
  if (typeof window === "undefined") return null;
  if (!hasStoredSettings()) return null;

  const settings = loadSettings();
  const before: StreakProtection = settings.streakProtection;
  const streakDates = loadStreakData();
  const result = applyProtectionStep(before, streakDates, today);

  // Avoid an unnecessary write when nothing meaningful changed. The earn-leg
  // guard sets `lastEarnCheckDate` even on a counter increment, so a strict
  // deep equal would write daily even with no logical movement. Detect by
  // checking the meaningful keys instead.
  const changed =
    result.protection.balance !== before.balance ||
    result.protection.daysSinceLastEarn !== before.daysSinceLastEarn ||
    result.protection.lastEarnCheckDate !== before.lastEarnCheckDate ||
    result.protection.spendDates.length !== before.spendDates.length;

  if (changed) {
    saveSettings({ ...settings, streakProtection: result.protection });
  }

  return result;
}
