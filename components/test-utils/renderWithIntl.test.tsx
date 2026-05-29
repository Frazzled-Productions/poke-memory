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
 *
 * The component under test is a minimal stub defined inline — this file
 * tests the helper infrastructure, not any production component.
 */

import { describe, it, expect } from "vitest";
import { useTranslations } from "next-intl";
import { renderWithIntl, renderJa, screen } from "./renderWithIntl";

// ---------------------------------------------------------------------------
// Minimal test component — calls useTranslations and renders the value.
// ---------------------------------------------------------------------------

function NavPracticeLabel() {
  const t = useTranslations("nav");
  return <span>{t("practice")}</span>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderWithIntl helper", () => {
  it("renders without throwing when a component calls useTranslations()", () => {
    // No NextIntlClientProvider mock needed — the helper provides the real one.
    expect(() => renderWithIntl(<NavPracticeLabel />)).not.toThrow();
  });

  it("shows the English value by default (locale defaults to 'en')", () => {
    renderWithIntl(<NavPracticeLabel />);
    // messages/en.json nav.practice = "Practice"
    expect(screen.getByText("Practice")).toBeInTheDocument();
  });

  it("shows the Japanese value when locale is 'ja'", () => {
    renderWithIntl(<NavPracticeLabel />, { locale: "ja" });
    // messages/ja.json nav.practice = "練習"
    expect(screen.getByText("練習")).toBeInTheDocument();
  });

  it("renderJa() is an alias for renderWithIntl(_, { locale: 'ja' })", () => {
    renderJa(<NavPracticeLabel />);
    expect(screen.getByText("練習")).toBeInTheDocument();
  });

  it("shows the Simplified Chinese value when locale is 'zh-Hans'", () => {
    renderWithIntl(<NavPracticeLabel />, { locale: "zh-Hans" });
    // messages/zh-Hans.json nav.practice = "练习"
    expect(screen.getByText("练习")).toBeInTheDocument();
  });

  it("shows the Traditional Chinese value when locale is 'zh-Hant'", () => {
    renderWithIntl(<NavPracticeLabel />, { locale: "zh-Hant" });
    // messages/zh-Hant.json nav.practice = "練習"
    expect(screen.getByText("練習")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Verify distinct en vs ja values (guards against catalogue being identical).
// ---------------------------------------------------------------------------

describe("renderWithIntl — locale switching produces distinct output", () => {
  it("English and Japanese produce different text for nav.practice", () => {
    const { unmount } = renderWithIntl(<NavPracticeLabel />);
    expect(screen.getByText("Practice")).toBeInTheDocument();
    unmount();

    renderJa(<NavPracticeLabel />);
    expect(screen.getByText("練習")).toBeInTheDocument();
    expect(screen.queryByText("Practice")).toBeNull();
  });
});
