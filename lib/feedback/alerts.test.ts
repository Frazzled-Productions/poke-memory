/**
 * The feedback emails (Fraser's ruling, 20 November 2026: Discord dropped for
 * email): the new-bug-report alert and the weekly digest, with the same
 * content the Discord embeds had. Neither ever holds a user id or email
 * address. `fetch` is mocked: nothing reaches Resend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bugReportAlert,
  feedbackDigestAlert,
  MESSAGE_PREVIEW_MAX,
  sendBugReportAlert,
  type FeedbackNotice,
} from "./alerts";

const RESEND = "https://api.resend.com/emails";
const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const notice: FeedbackNotice = {
  id: "0b6f2a54-9a3e-4c4b-8d0a-5f1e2b3c4d5e",
  page: "/practice",
  app_version: "1.2.3",
  created_at: "2026-11-20T10:15:00.000Z",
  authenticated: true,
};

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  for (const level of ["error", "info", "warn"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bugReportAlert", () => {
  it("holds the page, app version, sign-in state, time, message preview and feedback id", () => {
    const alert = bugReportAlert(notice, "it crashed");
    expect(alert.tag).toBe("feedback-alert");
    expect(alert.subject).toBe("Poké Memory: new bug report");
    expect(alert.text).toBe(
      [
        "New bug report",
        "",
        "Page: /practice",
        "App version: 1.2.3",
        "Authenticated: Yes",
        "Timestamp: 2026-11-20T10:15:00.000Z",
        "",
        "Message preview:",
        "it crashed",
        "",
        `Feedback id: ${notice.id}`,
        "",
        "Poké Memory feedback system",
      ].join("\n"),
    );
  });

  it("shows a guest as 'No (guest)' and a missing page or version as '(not provided)'", () => {
    const { text } = bugReportAlert({ ...notice, authenticated: false, page: null, app_version: null }, "x");
    expect(text).toContain("Authenticated: No (guest)");
    expect(text).toContain("Page: (not provided)");
    expect(text).toContain("App version: (not provided)");
  });

  it("leaves the preview out when the message could not be read", () => {
    expect(bugReportAlert(notice, null).text).not.toContain("Message preview");
  });
});

describe("sendBugReportAlert", () => {
  const env = { DEPLOY_ENV: "cloudflare-production", RESEND_API_KEY: "re_test" };

  it("emails the report through Resend, the preview capped at 500 characters plus an ellipsis", async () => {
    const message = "a".repeat(MESSAGE_PREVIEW_MAX + 1);
    expect(await sendBugReportAlert(env, async () => message, notice)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(RESEND);
    const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
    expect(body.to).toEqual(["hello@frazzledproductions.com"]);
    expect(body.subject).toBe("Poké Memory: new bug report");
    expect(body.text).toContain(`Message preview:\n${"a".repeat(MESSAGE_PREVIEW_MAX)}…\n`);
  });

  it("still sends, without the preview, when reading the message fails", async () => {
    expect(
      await sendBugReportAlert(env, async () => {
        throw new Error("D1_ERROR: down");
      }, notice),
    ).toBe(true);
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain("Message preview");
  });

  it("logs and skips without RESEND_API_KEY", async () => {
    expect(await sendBugReportAlert({ DEPLOY_ENV: "cloudflare-production" }, async () => "x", notice)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("feedback-alert: alert not sent: no RESEND_API_KEY");
  });

  it("sends nothing outside production, even with a key", async () => {
    const readMessage = vi.fn(async () => "x");
    expect(await sendBugReportAlert({ ...env, DEPLOY_ENV: "cloudflare-preview" }, readMessage, notice)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readMessage).not.toHaveBeenCalled();
  });

  it("CRITICAL: the email never holds a user id", async () => {
    await sendBugReportAlert(env, async () => "it crashed", notice);
    const raw = String(fetchMock.mock.calls[0][1]?.body);
    expect(raw).not.toContain(USER_ID);
    expect(raw).not.toMatch(/user_id|user id/i);
  });
});

describe("feedbackDigestAlert", () => {
  it("counts by category, signed-in against guest, in a stable order", () => {
    const alert = feedbackDigestAlert(7, [
      { category: "feature", authenticated: true },
      { category: "bug", authenticated: true },
      { category: "bug", authenticated: false },
      { category: "other", authenticated: false },
      { category: "bug", authenticated: true },
    ]);
    expect(alert.tag).toBe("feedback-digest");
    expect(alert.subject).toBe("Poké Memory: weekly feedback digest");
    expect(alert.text).toBe(
      [
        "Weekly feedback digest",
        "",
        "Window: Past 7 days",
        "Total: 5",
        "Bug: 3 (2 auth, 1 guest)",
        "Feature: 1 (1 auth, 0 guest)",
        "Other: 1 (0 auth, 1 guest)",
        "",
        "Poké Memory feedback system",
      ].join("\n"),
    );
  });

  it("still reports an empty window, and gives a category with no rows no line", () => {
    const { text } = feedbackDigestAlert(1, []);
    expect(text).toContain("Window: Past 1 day\n");
    expect(text).toContain("Total: 0");
    expect(text).not.toMatch(/^(Bug|Feature|Other):/m);
  });
});
