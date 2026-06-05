/**
 * Self-tests for the renderWithIntl helper (#1369).
 *
 * Verifies that:
 *  - The helper renders a component that calls `useTranslations()` without
 *    throwing (i.e. the NextIntlClientProvider ancestor is in place).
 *  - The English catalogue is used by default (`locale` defaults to "en").
 *  - The Japanese catalogue is used when `locale: "ja"` is passed.
 *  - `renderJa` is a true convenience alias for the Japanese locale.
 *  - Simplified Chinese and Traditional Chinese catalogues also resolve.
 *  - Each locale produces a DISTINCT value, so a mis-wired MESSAGES map
 *    (e.g. zh-Hant pointing at jaMessages) fails the test.
 *
 * The component under test is a minimal stub defined inline - this file
 * tests the helper infrastructure, not any production component.
 *
 * Key choice - `nav.brand` as the assertion key:
 *   en       → "poke-memory"
 *   ja       → "ポケメモリー"
 *   zh-Hans  → "宝可记忆"
 *   zh-Hant  → "寶可記憶"
 * All four values are unique, so any two-locale swap is immediately detected.
 * (`nav.practice` was the previous key; Traditional Chinese shares "練習"
 * with Japanese, making zh-Hant→ja misconfigurations invisible.)
 */

import { describe, it, expect } from "vitest";
import { useTranslations } from "next-intl";
import { renderWithIntl, renderJa, screen } from "./renderWithIntl";

// ---------------------------------------------------------------------------
// Minimal test component - calls useTranslations and renders the value.
// ---------------------------------------------------------------------------

function NavBrandLabel() {
  const t = useTranslations("nav");
  return <span>{t("brand")}</span>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderWithIntl helper", () => {
  it("renders without throwing when a component calls useTranslations()", () => {
    // No NextIntlClientProvider mock needed - the helper provides the real one.
    expect(() => renderWithIntl(<NavBrandLabel />)).not.toThrow();
  });

  it("shows the English value by default (locale defaults to 'en')", () => {
    renderWithIntl(<NavBrandLabel />);
    // messages/en.json nav.brand = "poke-memory"
    expect(screen.getByText("poke-memory")).toBeInTheDocument();
  });

  it("shows the Japanese value when locale is 'ja'", () => {
    renderWithIntl(<NavBrandLabel />, { locale: "ja" });
    // messages/ja.json nav.brand = "ポケメモリー"
    expect(screen.getByText("ポケメモリー")).toBeInTheDocument();
  });

  it("renderJa() is an alias for renderWithIntl(_, { locale: 'ja' })", () => {
    renderJa(<NavBrandLabel />);
    // messages/ja.json nav.brand = "ポケメモリー"
    expect(screen.getByText("ポケメモリー")).toBeInTheDocument();
  });

  it("shows the Simplified Chinese value when locale is 'zh-Hans'", () => {
    renderWithIntl(<NavBrandLabel />, { locale: "zh-Hans" });
    // messages/zh-Hans.json nav.brand = "宝可记忆"
    expect(screen.getByText("宝可记忆")).toBeInTheDocument();
  });

  it("shows the Traditional Chinese value when locale is 'zh-Hant'", () => {
    renderWithIntl(<NavBrandLabel />, { locale: "zh-Hant" });
    // messages/zh-Hant.json nav.brand = "寶可記憶"
    // This is DISTINCT from the Japanese value ("ポケメモリー"), so a
    // zh-Hant→jaMessages misconfiguration causes this assertion to fail.
    expect(screen.getByText("寶可記憶")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Verify distinct values guard - every locale produces a unique string.
// A mis-wired MESSAGES map (e.g. two locales pointing at the same catalogue)
// is caught because only one value can appear in the document at a time.
// ---------------------------------------------------------------------------

describe("renderWithIntl - locale switching produces distinct output", () => {
  it("all four locales render different brand text", () => {
    const locales: Array<{
      locale: "en" | "ja" | "zh-Hans" | "zh-Hant";
      expected: string;
    }> = [
      { locale: "en", expected: "poke-memory" },
      { locale: "ja", expected: "ポケメモリー" },
      { locale: "zh-Hans", expected: "宝可记忆" },
      { locale: "zh-Hant", expected: "寶可記憶" },
    ];

    for (const { locale, expected } of locales) {
      const { unmount } = renderWithIntl(<NavBrandLabel />, { locale });
      expect(screen.getByText(expected)).toBeInTheDocument();
      // Verify no other locale's brand text leaked into the document.
      const others = locales
        .filter((l) => l.locale !== locale)
        .map((l) => l.expected);
      for (const other of others) {
        expect(screen.queryByText(other)).toBeNull();
      }
      unmount();
    }
  });
});
