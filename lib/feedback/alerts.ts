/**
 * The feedback emails to the company mailbox (#1653, #1848; Discord dropped
 * for email by Fraser's ruling of 20 November 2026), sent through
 * lib/alertEmail.ts:
 *
 *   - the new-bug-report alert, from POST /api/feedback (ctx.waitUntil);
 *   - the weekly digest, from POST /api/cron/feedback-digest.
 *
 * Same content as the Discord embeds they replace. The bug alert carries the
 * page, app version, signed in or guest, the time, a preview of the message
 * capped at 500 characters and the random feedback id (for finding the row in
 * D1). Neither email ever holds a user id or email address. The message is
 * read through a function the caller passes, so this module holds no SQL and
 * does not import lib/db/system.
 */
import { sendAlertEmail, type Alert, type AlertEnv } from "@/lib/alertEmail";
import { outboundAllowed } from "@/lib/outbound";

/** Safe feedback metadata for the bug alert: never the message or user_id. */
export type FeedbackNotice = {
  id: string;
  page: string | null;
  app_version: string | null;
  created_at: string;
  authenticated: boolean;
};

/** Maximum characters of the message preview in the bug alert. */
export const MESSAGE_PREVIEW_MAX = 500;

const FOOTER = "Poké Memory feedback system";

function preview(message: string): string {
  return message.length > MESSAGE_PREVIEW_MAX ? message.slice(0, MESSAGE_PREVIEW_MAX) + "…" : message;
}

/** The bug alert. `messagePreview` null leaves the preview out. */
export function bugReportAlert(notice: FeedbackNotice, messagePreview: string | null): Alert {
  const lines = [
    "New bug report",
    "",
    `Page: ${notice.page ?? "(not provided)"}`,
    `App version: ${notice.app_version ?? "(not provided)"}`,
    `Authenticated: ${notice.authenticated ? "Yes" : "No (guest)"}`,
    `Timestamp: ${new Date(notice.created_at).toISOString()}`,
    "",
    ...(messagePreview !== null ? ["Message preview:", messagePreview, ""] : []),
    `Feedback id: ${notice.id}`,
    "",
    FOOTER,
  ];
  return { tag: "feedback-alert", subject: "Poké Memory: new bug report", text: lines.join("\n") };
}

/**
 * Emails the bug alert for `notice`. Only where outbound sends are allowed
 * (production); without RESEND_API_KEY it is logged and skipped. A failed
 * message read leaves the preview out. Never throws; true when sent.
 */
export async function sendBugReportAlert(
  env: AlertEnv & { DEPLOY_ENV?: string },
  readMessage: (feedbackId: string) => Promise<string | null>,
  notice: FeedbackNotice,
): Promise<boolean> {
  if (!outboundAllowed(env)) {
    console.info("[feedback] would email a bug report; outbound off");
    return false;
  }
  let messagePreview: string | null = null;
  try {
    const message = await readMessage(notice.id);
    if (message === null) console.warn("[feedback] no feedback row for the preview");
    else messagePreview = preview(message);
  } catch (err) {
    console.warn("[feedback] reading the message for the preview failed", err);
  }
  return sendAlertEmail(env, bugReportAlert(notice, messagePreview));
}

const CATEGORY_ORDER = ["bug", "feature", "other"];

/** The weekly digest: counts by category, signed-in against guest. Never the message or user_id. */
export function feedbackDigestAlert(
  windowDays: number,
  rows: readonly { category: string; authenticated: boolean }[],
): Alert {
  const lines = [
    "Weekly feedback digest",
    "",
    `Window: Past ${windowDays} day${windowDays === 1 ? "" : "s"}`,
    `Total: ${rows.length}`,
  ];
  for (const category of CATEGORY_ORDER) {
    const inCategory = rows.filter((r) => r.category === category);
    if (inCategory.length === 0) continue;
    const auth = inCategory.filter((r) => r.authenticated).length;
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(`${label}: ${inCategory.length} (${auth} auth, ${inCategory.length - auth} guest)`);
  }
  lines.push("", FOOTER);
  return { tag: "feedback-digest", subject: "Poké Memory: weekly feedback digest", text: lines.join("\n") };
}
