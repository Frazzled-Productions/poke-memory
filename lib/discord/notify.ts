/**
 * The Discord bug notification (#1653, #1848, ops #405), shared by
 * POST /api/feedback (which sends it itself since the move from the Postgres
 * trigger, design D3), POST /api/discord/notify and the feedback retention
 * job.
 *
 *   - postBugNotification: posts an embed for a new bug report with a capped
 *     message preview, using `?wait=true` so Discord returns the message id,
 *     and stores that id against the feedback id.
 *   - deleteBugNotification: when the feedback row is deleted (12-month
 *     retention, account deletion), deletes the post, preview included, then
 *     the stored id.
 *
 * The notice never carries the message or user_id; the preview is read by id
 * through the store. Database access comes in through DiscordPostStore
 * (lib/db/system/feedback.ts), so this module holds no SQL. Every Discord
 * call is gated on outboundAllowed(): elsewhere the work is logged, not sent.
 */
import { outboundAllowed } from "@/lib/outbound";
import { deleteWebhookMessage, webhookUrlFor, type DiscordEnv } from "./webhook";

/** Safe feedback metadata for the embed (the old trigger payload). */
export type FeedbackNotice = {
  id: string;
  category: string;
  page: string | null;
  app_version: string | null;
  created_at: string;
  authenticated: boolean;
};

/** The database side, implemented by discordPostStore (lib/db/system). */
export interface DiscordPostStore {
  /** The feedback message, or null when the row is gone. */
  feedbackMessage(feedbackId: string): Promise<string | null>;
  feedbackExists(feedbackId: string): Promise<boolean>;
  storeMessageId(feedbackId: string, messageId: string): Promise<void>;
  messageIdFor(feedbackId: string): Promise<string | null>;
  forgetMessageId(feedbackId: string): Promise<void>;
}

export type NotifyResult =
  | { ok: true; posted: boolean }
  | { ok: false; error: "misconfigured" | "webhook_fetch_failed" }
  | { ok: false; error: "webhook_error"; status: number };

export type DeleteNotificationResult =
  | { ok: true; deleted: boolean }
  | { ok: false; error: "misconfigured" | "lookup_failed" | "webhook_fetch_failed" }
  | { ok: false; error: "webhook_error"; status: number };

/** Maximum characters in the message preview field sent to Discord. */
export const MESSAGE_PREVIEW_MAX = 500;

/** Discord embed colour for bug reports (red). */
const EMBED_COLOUR_BUG = 0xe74c3c;

function preview(message: string): string {
  return message.length > MESSAGE_PREVIEW_MAX ? message.slice(0, MESSAGE_PREVIEW_MAX) + "…" : message;
}

/** The embed for a bug report. `messagePreview` null leaves the field out. */
export function buildBugEmbed(notice: FeedbackNotice, messagePreview: string | null) {
  return {
    title: "New bug report",
    color: EMBED_COLOUR_BUG,
    fields: [
      { name: "Page", value: notice.page ?? "(not provided)", inline: true },
      { name: "App version", value: notice.app_version ?? "(not provided)", inline: true },
      { name: "Authenticated", value: notice.authenticated ? "Yes" : "No (guest)", inline: true },
      { name: "Timestamp", value: new Date(notice.created_at).toISOString(), inline: false },
      ...(messagePreview !== null ? [{ name: "Message preview", value: messagePreview, inline: false }] : []),
      // The random feedback id (never the user id), for finding the row in D1.
      { name: "Feedback id", value: notice.id, inline: false },
    ],
    footer: { text: "Poké Memory feedback system" },
  };
}

async function readPreview(store: DiscordPostStore, feedbackId: string): Promise<string | null> {
  try {
    const message = await store.feedbackMessage(feedbackId);
    if (message === null) console.warn("[discord/notify] no feedback row for the preview");
    return message === null ? null : preview(message);
  } catch (err) {
    console.warn("[discord/notify] message fetch threw", err);
    return null;
  }
}

/** Stores the posted message id. Failures are logged, never fatal: the post is out. */
async function storeMessageId(store: DiscordPostStore, feedbackId: string, discordRes: Response): Promise<boolean> {
  try {
    const sent = (await discordRes.json()) as { id?: unknown };
    if (typeof sent.id !== "string" || sent.id === "") {
      console.error("[discord/notify] webhook response had no message id; post cannot be deleted later");
      return false;
    }
    await store.storeMessageId(feedbackId, sent.id);
    return true;
  } catch (err) {
    console.error("[discord/notify] storing the Discord message id failed", err);
    return false;
  }
}

/** Posts the bug notification for `notice` and stores its message id. Never throws. */
export async function postBugNotification(
  env: DiscordEnv,
  store: DiscordPostStore,
  notice: FeedbackNotice,
): Promise<NotifyResult> {
  const messagePreview = await readPreview(store, notice.id);
  const embed = buildBugEmbed(notice, messagePreview);

  if (!outboundAllowed(env)) {
    console.info(`[discord/notify] would post a bug notification (${embed.fields.length} fields); outbound off`);
    return { ok: true, posted: false };
  }
  const webhookUrl = env.DISCORD_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("[discord/notify] DISCORD_NOTIFY_WEBHOOK_URL is not set");
    return { ok: false, error: "misconfigured" };
  }

  let discordRes: Response;
  try {
    discordRes = await fetch(webhookUrlFor(webhookUrl, "", true), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (err) {
    console.error("[discord/notify] fetch failed", err);
    return { ok: false, error: "webhook_fetch_failed" };
  }
  if (!discordRes.ok) {
    const errText = await discordRes.text().catch(() => "(unreadable)");
    console.error("[discord/notify] webhook error", discordRes.status, errText);
    return { ok: false, error: "webhook_error", status: discordRes.status };
  }

  if (await storeMessageId(store, notice.id, discordRes)) {
    // The row went while the post was in flight, before its id was stored, so
    // the delete found nothing to remove: delete the post now.
    const gone = await store.feedbackExists(notice.id).then(
      (exists) => !exists,
      (err) => {
        console.error("[discord/notify] re-checking the feedback row failed", err);
        return false;
      },
    );
    if (gone) await deleteBugNotification(env, store, notice.id);
  }
  return { ok: true, posted: true };
}

/**
 * Deletes the stored post for a deleted feedback row, then its stored id. Any
 * failure keeps the stored id, so a later run can try again. Never throws.
 */
export async function deleteBugNotification(
  env: DiscordEnv,
  store: DiscordPostStore,
  feedbackId: string,
): Promise<DeleteNotificationResult> {
  let messageId: string | null;
  try {
    messageId = await store.messageIdFor(feedbackId);
  } catch (err) {
    console.error("[discord/notify] reading the stored Discord message id failed", err);
    return { ok: false, error: "lookup_failed" };
  }
  if (messageId === null) return { ok: true, deleted: false };

  if (!outboundAllowed(env)) {
    console.info("[discord/notify] would delete a bug notification post; outbound off");
    return { ok: true, deleted: false };
  }
  const webhookUrl = env.DISCORD_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("[discord/notify] DISCORD_NOTIFY_WEBHOOK_URL is not set");
    return { ok: false, error: "misconfigured" };
  }

  const outcome = await deleteWebhookMessage(webhookUrl, messageId);
  if (!outcome.ok) return outcome;

  try {
    await store.forgetMessageId(feedbackId);
  } catch (err) {
    console.error("[discord/notify] removing the stored Discord message id failed", err);
  }
  return { ok: true, deleted: true };
}
