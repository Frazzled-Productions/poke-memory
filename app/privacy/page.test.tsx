/**
 * Smoke test for the Privacy Notice page (#1056, #1349, #1544).
 *
 * Server Components for static legal copy don't need branch coverage in the
 * usual sense, but the diff-coverage gate counts any added product line. The
 * Web Push section added for #1056 (lines 158-179) needs at least one render
 * assertion so those lines are instrumented.
 *
 * #1349: the English-only notice is controlled by resolveLocale(). The mock
 * below exercises both the "en" path (notice absent) and a non-"en" path
 * (notice present).
 *
 * #1544: ChildFriendlySummary is now an async server component. It is stubbed
 * here so the async render does not block or suspend in the jsdom environment.
 * ChildFriendlySummary.test.tsx carries the locale-coverage assertions;
 * this file keeps the page-level smoke tests.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import PrivacyPage from "@/app/privacy/page";

// ---------------------------------------------------------------------------
// Stub ChildFriendlySummary — it is now async; stubbing avoids the suspended
// async component causing the page render to return an empty div. Locale
// rendering is asserted in components/privacy/ChildFriendlySummary.test.tsx.
// ---------------------------------------------------------------------------

vi.mock("@/components/privacy/ChildFriendlySummary", () => ({
  default: () => <section>Child-friendly summary (stub)</section>,
}));

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

    it("names the incorporated controller in section 1 (#1565)", async () => {
      await renderPage();
      // The controller section must identify the legal entity and company number
      // so users can exercise their UK-GDPR rights against the correct entity.
      const nameMatches = screen.getAllByText(/frazzled productions ltd/i);
      expect(nameMatches.length).toBeGreaterThan(0);
      const numberMatches = screen.getAllByText(/17258540/i);
      expect(numberMatches.length).toBeGreaterThan(0);
    });

    it("renders the feedback submissions section added for #1623", async () => {
      await renderPage();
      // The new sub-heading describing feedback data collection.
      expect(
        screen.getByRole("heading", {
          level: 3,
          name: /feedback submissions/i,
        }),
      ).toBeTruthy();
      // Guest feedback is not linked to an identifiable account.
      expect(
        screen.getByText(/not linked to any identifiable account/i),
      ).toBeTruthy();
      // Feedback is not used for profiling or marketing.
      expect(
        screen.getByText(/not used for profiling or marketing/i),
      ).toBeTruthy();
    });

    it("renders the feedback retention statement in section 8 (#1623)", async () => {
      await renderPage();
      expect(
        screen.getByText(/feedback submissions are retained for 12 months/i),
      ).toBeTruthy();
    });

    it("renders the feedback lawful basis row in section 5 (#1623)", async () => {
      await renderPage();
      expect(
        screen.getByText(/receive and act on feedback you submit voluntarily/i),
      ).toBeTruthy();
      expect(
        screen.getByText(/legitimate interest in improving the service and resolving/i),
      ).toBeTruthy();
    });

    it("mentions feedback cascade deletion in the erasure rights bullet (#1623)", async () => {
      await renderPage();
      expect(
        screen.getByText(/also permanently deletes any feedback submissions linked to it/i),
      ).toBeTruthy();
    });

    it("shows the last updated date as 4 June 2026 (#1623)", async () => {
      await renderPage();
      expect(screen.getByText(/4 june 2026/i)).toBeTruthy();
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
      const links = screen.getAllByRole("link", { name: /privacy@pokememory.com/ });
      expect(links.length).toBeGreaterThan(0);
    });
  });
});
