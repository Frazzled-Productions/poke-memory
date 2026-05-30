/**
 * Pure number-formatting helpers for non-component contexts (tooltip formatter
 * callbacks, lib code) where React hooks cannot be called.
 *
 * For component code, prefer `useFormatter()` from next-intl directly:
 *
 *   const format = useFormatter();
 *   format.number(1234567)
 *   format.number(0.875, { style: 'percent', maximumFractionDigits: 0 })
 *
 * These pure functions accept an explicit `locale` parameter threaded from
 * the component via `useAppLocale()`.
 *
 * Part of #1408 — centralised number formatting / pluralisation.
 */

import type { AppLocale } from "@/i18n/locales";

/**
 * Format an integer count in the active locale.
 *
 * Examples (count = 1234567):
 *   en   → "1,234,567"
 *   ja   → "1,234,567"
 *   zh-Hans → "1,234,567"
 *
 * @param n      The number to format.
 * @param locale The active app locale (from `useAppLocale()`).
 */
export function formatCount(n: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale).format(n);
}

/**
 * Format a fraction as a percentage with no decimal places.
 *
 * Examples (v = 0.875):
 *   en   → "88%"
 *   ja   → "88%"
 *
 * @param v      A value in [0, 1].
 * @param locale The active app locale (from `useAppLocale()`).
 */
export function formatPercent(v: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(v);
}
