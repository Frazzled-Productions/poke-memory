/**
 * After delete_account: asks /api/discord/notify to delete each Discord post
 * of the account's bug reports, the job the Postgres trigger of migration 051
 * did on every feedback delete (design D3). The notify handler is called in
 * process with the same body and bearer the trigger sent, so no network hop
 * is needed; it looks the post up in feedback_discord_posts, deletes the
 * Discord message and then the stored id. Failures are logged, never thrown:
 * the account is already gone, and the retention job keeps no other record.
 */
import type { DiscordPostToDelete } from "@/lib/db/rpc/deleteAccount";
import { POST as notifyDiscord } from "@/app/api/discord/notify/route";

export async function deleteDiscordPosts(posts: readonly DiscordPostToDelete[]): Promise<void> {
  const secret = process.env.CRON_SHARED_SECRET;
  if (!secret) {
    if (posts.length > 0) console.error("[api/db] CRON_SHARED_SECRET unset; Discord posts not deleted");
    return;
  }
  for (const post of posts) {
    try {
      const res = await notifyDiscord(
        new Request("http://internal/api/discord/notify", {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({ event: "deleted", id: post.feedbackId }),
        }),
      );
      if (!res.ok) console.error("[api/db] Discord post delete failed", res.status);
    } catch (err) {
      console.error("[api/db] Discord post delete threw", err);
    }
  }
}
