/**
 * Smoke test for the Privacy Notice page (#1056, #1349).
 *
 * Server Components for static legal copy don't need branch coverage in the
 * usual sense, but the diff-coverage gate counts any added product line. The
 * Web Push section added for #1056 (lines 158-179) needs at least one render
 * assertion so those lines are instrumented.
 *
 * The page is a pure server function returning JSX with no data fetching; we
 * can render it directly under jsdom. ChildFriendlySummary renders too and
 * its `next/link` is implicitly handled by jsdom — no router mock needed.
 *
 * #1349: the English-only notice is controlled by resolveLocale(). The mock
 * below exercises both the "en" path (notice absent) and a non-"en" path
 * (notice present).
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import PrivacyPage from "@/app/privacy/page";

// ---------------------------------------------------------------------------
// Mock resolveLocale so the server-component locale gate is testable.
// The default is "en" (authoritative locale — notice should be hidden).
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
  const jsx = await PrivacyPage();
  render(jsx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Privacy Notice page", () => {
  describe("English locale (default)", () => {
    it("renders the document heading", async () => {
      await renderPage();
      expect(
        screen.getByRole("heading", { level: 1, name: /privacy notice/i }),
      ).toBeTruthy();
    });

    it("renders the Web Push subscriptions section added for #1056", async () => {
      await renderPage();
      // The new sub-heading and the surrounding body copy that explains why we
      // store endpoint + p256dh + auth.
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: /web push subscriptions/i,
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(/single daily notification when you have/i),
      ).toBeTruthy();
      // Mentions the table name push_subscriptions so the reader can map the
      // notice to the schema.
      expect(screen.getByText(/push_subscriptions/i)).toBeTruthy();
    });

    it("still renders the unchanged sections it already covered", async () => {
      await renderPage();
      // A handful of stable anchors that pre-date #1056; if these regress the
      // notice has been gutted by mistake.
      expect(
        screen.getByRole("heading", { level: 2, name: /data controller/i }),
      ).toBeTruthy();
      expect(
        screen.getByRole("heading", { level: 2, name: /right to complain/i }),
      ).toBeTruthy();
    });

    it("does NOT show the English-only notice in the English locale", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("en");
      await renderPage();
      expect(
        screen.queryByText(/this privacy notice is written in english only/i),
      ).toBeNull();
    });
  });

  describe("Non-English locale", () => {
    it("shows the English-only notice when locale is Japanese", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("ja");
      await renderPage();
      expect(
        screen.getByText(/this privacy notice is written in english only/i),
      ).toBeTruthy();
    });

    it("shows the English-only notice when locale is Simplified Chinese", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("zh-Hans");
      await renderPage();
      expect(
        screen.getByText(/this privacy notice is written in english only/i),
      ).toBeTruthy();
    });

    it("shows at least one contact email link in the notice", async () => {
      vi.mocked(resolveLocale).mockResolvedValueOnce("ja");
      await renderPage();
      // There are multiple email links on the privacy page; verify at least one is present.
      const links = screen.getAllByRole("link", { name: /fbrookhouse@gmail\.com/ });
      expect(links.length).toBeGreaterThan(0);
    });
  });
});
