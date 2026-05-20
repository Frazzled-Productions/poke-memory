import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Push subscriptions cross-device sync (#1056).
 *
 * Per docs/sync.md "Auxiliary sync legs are best-effort": this whole module
 * is sidecar to the cards sync contract. Push subscriptions are device-
 * specific (each browser/PWA install has its own endpoint), so the most
 * useful cross-device signal is "this user is subscribed somewhere" — not
 * the full row list. The pull leg's only job is to surface whether the
 * caller currently has at least one row server-side; the UI uses that to
 * render an accurate initial toggle state on a fresh device that has not
 * yet subscribed locally.
 *
 * There is no push leg because subscribe/unsubscribe write to the DB
 * directly (see lib/push/subscribe.ts). That keeps the contract simple:
 * the cloud is the source of truth, this device's PushManager state is
 * the local cache.
 */

/**
 * Returns the number of push subscription rows the authenticated caller
 * currently owns. The result is server-side, RLS-filtered to the calling
 * user. Returns null on any error so callers can distinguish "no data" (0)
 * from "we don't know" (null).
 *
 * Best-effort: never throws. Errors are reported via the null return and
 * a console.warn — they must not flip overall sync into the error state.
 */
export async function pullPushSubscriptionCount(
  client: SupabaseClient,
  userId: string,
): Promise<number | null> {
  try {
    const { count, error } = await client
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) {
      console.warn("[pushSubscriptions] pull failed (non-fatal)", error);
      return null;
    }
    return count ?? 0;
  } catch (e) {
    console.warn("[pushSubscriptions] pull threw (non-fatal)", e);
    return null;
  }
}
