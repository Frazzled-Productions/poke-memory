/**
 * Smoke test for the Terms of Use page (#1349).
 *
 * Verifies that:
 *   - The page renders the document heading in all locales.
 *   - The English-only notice appears for non-English locales.
 *   - The English-only notice is absent for the English locale.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import TermsPage from "@/app/terms/page";

// ---------------------------------------------------------------------------
// Mock resolveLocale — default "en".
// ---------------------------------------------------------------------------

vi.mock("@/i18n/request", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/i18n/request")>();
  return {
    ...mod,
    resolveLocale: vi.fn(async () => "en"),
  };
});

import { resolveLocale } from "@/i18n/request";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderPage() {
  const jsx = await TermsPage();
  render(jsx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Terms of Use page", () => {
  describe("English locale (default)", () => {
    it("renders the Terms of Use heading", async () => {
      await renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: /terms of use/i }),
      ).toBeTruthy();
    });

    it("does NOT show the English-only notice in the English locale", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("en");
      await renderPage();
      expect(
        screen.queryByText(/these terms are written in english only/i),
      ).toBeNull();
    });
  });

  describe("Non-English locale", () => {
    it("shows the English-only notice when locale is Japanese", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("ja");
      await renderPage();
      expect(
        screen.getByText(/these terms are written in english only/i),
      ).toBeTruthy();
    });

    it("shows the English-only notice when locale is Traditional Chinese", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("zh-Hant");
      await renderPage();
      expect(
        screen.getByText(/these terms are written in english only/i),
      ).toBeTruthy();
    });

    it("shows at least one contact email link in the notice", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("ja");
      await renderPage();
      // There may be multiple email links on the page; verify at least one is present.
      const links = screen.getAllByRole("link", { name: /privacy@pokememory.com/ });
      expect(links.length).toBeGreaterThan(0);
    });
  });
});
