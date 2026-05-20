/**
 * Smoke test for the Privacy Notice page (#1056).
 *
 * Server Components for static legal copy don't need branch coverage in the
 * usual sense, but the diff-coverage gate counts any added product line. The
 * Web Push section added for #1056 (lines 158-179) needs at least one render
 * assertion so those lines are instrumented.
 *
 * The page is a pure server function returning JSX with no data fetching; we
 * can render it directly under jsdom. ChildFriendlySummary renders too and
 * its `next/link` is implicitly handled by jsdom — no router mock needed.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import PrivacyPage from "@/app/privacy/page";

describe("Privacy Notice page", () => {
  it("renders the document heading", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /privacy notice/i }),
    ).toBeTruthy();
  });

  it("renders the Web Push subscriptions section added for #1056", () => {
    render(<PrivacyPage />);
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

  it("still renders the unchanged sections it already covered", () => {
    render(<PrivacyPage />);
    // A handful of stable anchors that pre-date #1056; if these regress the
    // notice has been gutted by mistake.
    expect(
      screen.getByRole("heading", { level: 2, name: /data controller/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: /right to complain/i }),
    ).toBeTruthy();
  });
});
