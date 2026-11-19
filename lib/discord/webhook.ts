/**
 * Discord webhook calls shared by the feedback notification, its deletion
 * (ops #405) and account deletion. Every call is gated on outboundAllowed():
 * outside production nothing is sent and the caller is told so (design D2).
 */
import { outboundAllowed } from "@/lib/outbound";

export interface DiscordEnv {
  DEPLOY_ENV?: string;
  DISCORD_NOTIFY_WEBHOOK_URL?: string;
}

/**
 * The webhook URL with `extraPath` appended and `wait=true` set where asked.
 * Existing query parameters (such as `thread_id`) are kept.
 */
export function webhookUrlFor(webhookUrl: string, extraPath = "", wait = false): string {
  const url = new URL(webhookUrl);
  url.pathname = url.pathname.replace(/\/$/, "") + extraPath;
  if (wait) url.searchParams.set("wait", "true");
  return url.toString();
}

/** Discord's error code for a message it no longer has (Unknown Message). */
export const DISCORD_UNKNOWN_MESSAGE = 10008;

/** Rate-limit retries on a delete, and the longest wait honoured for each. */
const DELETE_RETRIES = 2;
const RETRY_WAIT_MAX_MS = 3000;

async function discordErrorBody(res: Response): Promise<{ code?: unknown; retry_after?: unknown }> {
  try {
    return (await res.json()) as { code?: unknown; retry_after?: unknown };
  } catch {
    return {};
  }
}

export type DeleteMessageResult =
  | { ok: true }
  | { ok: false; error: "webhook_fetch_failed" }
  | { ok: false; error: "webhook_error"; status: number };

/**
 * Deletes one message the webhook posted. Only Discord's "Unknown Message"
 * (404, code 10008) counts as already deleted: a 404 for an unknown webhook
 * means the post may still be up. A rate limit (429) is retried after
 * Discord's `retry_after`, a bounded number of times. Does not check
 * outboundAllowed(); callers do.
 */
export async function deleteWebhookMessage(webhookUrl: string, messageId: string): Promise<DeleteMessageResult> {
  const deleteUrl = webhookUrlFor(webhookUrl, `/messages/${encodeURIComponent(messageId)}`);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(deleteUrl, { method: "DELETE" });
    } catch (err) {
      console.error("[discord] delete fetch failed", err);
      return { ok: false, error: "webhook_fetch_failed" };
    }
    if (res.ok) return { ok: true };
    const err = await discordErrorBody(res);
    if (res.status === 404 && err.code === DISCORD_UNKNOWN_MESSAGE) return { ok: true };
    if (res.status === 429 && attempt < DELETE_RETRIES) {
      const waitMs = Math.min(Number(err.retry_after ?? 1) * 1000 || 1000, RETRY_WAIT_MAX_MS);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    console.error("[discord] webhook delete error", res.status, err.code);
    return { ok: false, error: "webhook_error", status: res.status };
  }
}

export type DeletePostsResult = {
  /** Gone from Discord (deleted now, or already unknown to it). */
  deleted: string[];
  /** Still up, or unknown: keep the stored ids and try again later. */
  failed: string[];
  /** Not attempted: outbound sends are off here, or no webhook is configured. */
  skipped: string[];
};

/**
 * Deletes the feedback-notification posts with these Discord message ids, one
 * at a time. For account deletion (lib/db/rpc) and any other bulk removal; the
 * caller removes the stored feedback_discord_posts rows of the `deleted` ids.
 * Outside production nothing is sent: the posts belong to the production
 * channel even when a preview database holds a copy of their ids.
 */
export async function deleteDiscordPosts(env: DiscordEnv, messageIds: readonly string[]): Promise<DeletePostsResult> {
  const result: DeletePostsResult = { deleted: [], failed: [], skipped: [] };
  if (messageIds.length === 0) return result;
  const webhookUrl = env.DISCORD_NOTIFY_WEBHOOK_URL;
  if (!outboundAllowed(env) || !webhookUrl) {
    console.info(
      `[discord] would delete ${messageIds.length} post(s); not sent (${webhookUrl ? "outbound off" : "no webhook"})`,
    );
    result.skipped.push(...messageIds);
    return result;
  }
  for (const messageId of messageIds) {
    const outcome = await deleteWebhookMessage(webhookUrl, messageId);
    (outcome.ok ? result.deleted : result.failed).push(messageId);
  }
  return result;
}
