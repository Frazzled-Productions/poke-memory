/**
 * Unit tests for the pure formatCount / formatPercent helpers.
 *
 * These functions are the lib-layer counterparts to `useFormatter()` from
 * next-intl — they are used in non-component contexts (tooltip formatters,
 * lib code) where hooks cannot be called. We verify that:
 *
 *   1. Numbers are grouped correctly in every supported locale.
 *   2. Percentages are rendered with no decimal places.
 *   3. The helpers accept every AppLocale without throwing.
 *
 * Part of #1408.
 */

import { describe, it, expect } from "vitest";
import { formatCount, formatPercent } from "./format-number";
import type { AppLocale } from "@/i18n/locales";

const SUPPORTED_LOCALES: AppLocale[] = ["en", "ja", "zh-Hans", "zh-Hant"];

describe("formatCount", () => {
  it("formats 0 in all locales without throwing", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(() => formatCount(0, locale)).not.toThrow();
      expect(formatCount(0, locale)).toBe(
        new Intl.NumberFormat(locale).format(0),
      );
    }
  });

  it("matches Intl.NumberFormat output in en", () => {
    expect(formatCount(1234567, "en")).toBe(
      new Intl.NumberFormat("en").format(1234567),
    );
  });

  it("matches Intl.NumberFormat output in ja", () => {
    expect(formatCount(1234567, "ja")).toBe(
      new Intl.NumberFormat("ja").format(1234567),
    );
  });

  it("matches Intl.NumberFormat output in zh-Hans", () => {
    expect(formatCount(1234567, "zh-Hans")).toBe(
      new Intl.NumberFormat("zh-Hans").format(1234567),
    );
  });

  it("matches Intl.NumberFormat output in zh-Hant", () => {
    expect(formatCount(1234567, "zh-Hant")).toBe(
      new Intl.NumberFormat("zh-Hant").format(1234567),
    );
  });
});

describe("formatPercent", () => {
  it("formats 0.875 as a percent with no decimal places in all locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const result = formatPercent(0.875, locale);
      expect(result).toBe(
        new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(0.875),
      );
    }
  });

  it("en: 0.875 rounds to 88%", () => {
    // Verify the expected output is percentage-shaped (contains a digit and percent sign).
    const result = formatPercent(0.875, "en");
    expect(result).toContain("88");
    expect(result).toContain("%");
  });

  it("ja: 0.875 renders as a percent string", () => {
    const result = formatPercent(0.875, "ja");
    expect(result).toBeTruthy();
    expect(result).toContain("%");
  });
});
