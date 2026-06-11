import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Web Push subscription helpers (#1056).
 *
 * Authenticated-only feature; guests never reach these helpers because the
 * UI surface (PushOptIn) does not render for them. The helpers themselves
 * are also defensive: they fail fast on unsupported environments and
 * return structured outcomes rather than throwing into the UI layer.
 *
 * The persistence shape matches the migration 028 `push_subscriptions`
 * table. Column names there use `auth_secret` (not `auth`) to dodge the
 * reserved word, but the PushSubscription JSON shape from the browser
 * uses `auth`; the row writer translates at the boundary.
 */

/**
 * True when the current environment can serve push notifications. Used to
 * gate the UI: returning false means the toggle is hidden entirely. The
 * three feature detections cover the full chain: SW registration → push
 * manager subscribe → showNotification on the SW side. Mobile Safari and
 * iOS PWAs gained all three in 16.4.
 */
export function isPushSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * True when the document is running as an installed PWA (display-mode:
 * standalone on Chromium/most browsers; `navigator.standalone` on iOS Safari).
 * iOS specifically REQUIRES the app to be installed to the Home Screen
 * before push subscriptions can be created - a regular Safari tab cannot
 * subscribe even with permission granted. The Settings page uses this to
 * hide the toggle outside standalone mode entirely; rendering the toggle
 * would just lead to a "Permission denied" error users could not act on.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  }
  // iOS Safari pre-standardisation hook. Defined only when running as a
  // Home Screen app.
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/**
 * Converts a base64url-encoded VAPID public key (the format the
 * `web-push generate-vapid-keys` CLI produces) into a Uint8Array
 * suitable for `applicationServerKey`. PushManager.subscribe accepts
 * either a string or a buffer; older browsers (pre-Chrome 109) require
 * the buffer shape, so we always convert.
 *
 * The function is pure and exported for unit testing - it's the kind of
 * thing that silently produces a wrong-shape key without complaint and
 * then PushManager.subscribe errors with a useless "Invalid raw ECDSA
 * P-256 public key" much later.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Structured outcome of `subscribeToPush`. */
export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "permission-denied" | "no-vapid-key" | "subscribe-failed" | "persist-failed" };

/** Structured outcome of `unsubscribeFromPush`. */
export type UnsubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "delete-failed" };

/**
 * Requests notification permission, creates a PushManager subscription
 * against the configured VAPID public key, then persists the resulting
 * endpoint + keys to Supabase under the caller's user_id.
 *
 * Behaviour notes:
 * - Permission is requested via `Notification.requestPermission()`. On iOS
 *   Safari this MUST run inside a user-gesture handler (the toggle click)
 *   or the prompt is suppressed without a "denied" reason - the caller
 *   must keep this call on the synchronous handler path.
 * - If the user has previously subscribed from this device, we reuse the
 *   existing PushManager subscription rather than tearing it down. The DB
 *   row for that (user_id, endpoint) pair is deleted and reinserted on every
 *   call so the operation stays inside the INSERT/DELETE policies - there
 *   is no UPDATE policy on push_subscriptions (see the persist block below).
 * - The DB row is keyed by (user_id, endpoint). One device that switches
 *   accounts therefore creates a second row; the new user owns the new
 *   row, the old user's row is still tied to its own user_id and will be
 *   cleaned up when the old user signs in again and re-subscribes (which
 *   replaces it) or when the endpoint goes dead (the daily route deletes
 *   on 410/404).
 */
export async function subscribeToPush(
  client: SupabaseClient,
  userId: string,
): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return { ok: false, reason: "no-vapid-key" };

  // Permission gate. `default` and `denied` both block subscribe(); we ask
  // explicitly to convert `default` into a real answer before going further.
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "permission-denied" };
  }
  if (permission !== "granted") {
    return { ok: false, reason: "permission-denied" };
  }

  // Resolve the active service worker registration. If the SW has not yet
  // hydrated, `ready` blocks until it does.
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    return { ok: false, reason: "subscribe-failed" };
  }

  // Reuse an existing subscription when present. On iOS the second
  // `subscribe()` call with a matching applicationServerKey is treated as
  // a no-op and returns the same subscription anyway, but doing the
  // explicit check saves a permission-prompt hop on browsers that
  // re-prompt.
  let subscription: PushSubscription | null = null;
  try {
    subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      // PushManager.subscribe wants `BufferSource`. The Uint8Array we built
      // is backed by a generic ArrayBufferLike that TS won't narrow to
      // ArrayBuffer; slicing into a fresh ArrayBuffer fixes the type and
      // is a tiny copy for the 65-byte VAPID key.
      const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
      const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
      new Uint8Array(keyBuffer).set(keyBytes);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuffer,
      });
    }
  } catch {
    return { ok: false, reason: "subscribe-failed" };
  }

  // Extract the keys we need to persist. `getKey` returns ArrayBuffer; we
  // base64url-encode for cross-origin transport and Supabase storage.
  const p256dhBuf = subscription.getKey("p256dh");
  const authBuf = subscription.getKey("auth");
  if (!p256dhBuf || !authBuf) {
    return { ok: false, reason: "subscribe-failed" };
  }
  const p256dh = arrayBufferToBase64Url(p256dhBuf);
  const auth = arrayBufferToBase64Url(authBuf);

  // Persist via delete-then-insert. Migration 028 deliberately omits an
  // UPDATE policy on push_subscriptions (per docs/persistence.md's
  // append-only baseline). Postgres treats INSERT ... ON CONFLICT DO UPDATE
  // as an UPDATE for RLS purposes, so a Supabase-client `.upsert(...)` on the
  // (user_id, endpoint) conflict key would silently fail every time a device
  // re-subscribes after the first one - the conflict branch is denied by RLS.
  // Removing the existing row first and inserting a fresh one keeps the
  // operation inside the SELECT/INSERT/DELETE policies that DO exist, and
  // sidesteps the missing UPDATE policy entirely. The cost is that a
  // returning subscriber gets a new `created_at`; we don't surface that
  // value anywhere user-facing, so the trade is fine.
  try {
    const { error: deleteError } = await client
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", subscription.endpoint);
    if (deleteError) return { ok: false, reason: "persist-failed" };

    const { error: insertError } = await client
      .from("push_subscriptions")
      .insert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh,
        auth_secret: auth,
        last_seen_at: new Date().toISOString(),
      });
    if (insertError) return { ok: false, reason: "persist-failed" };
  } catch {
    return { ok: false, reason: "persist-failed" };
  }

  return { ok: true };
}

/**
 * Tears down the push subscription on both sides: deletes every
 * `push_subscriptions` row for the user_id (the SELECT-only RLS policy
 * prevents wiping other users' rows), then unsubscribes the local
 * PushManager so the OS stops keeping the channel open.
 *
 * Note: we delete ALL rows for the user_id rather than just the row
 * matching the current endpoint. Endpoints can change across browser
 * updates and OS reinstalls, and a user signing out + back in on the same
 * device can otherwise accumulate stale rows that the daily route then
 * tries (and fails) to push to until 410 cleans them up.
 */
export async function unsubscribeFromPush(
  client: SupabaseClient,
  userId: string,
): Promise<UnsubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };

  // DB-side deletion first. If this fails we don't unsubscribe locally - 
  // doing so would leave a row that the daily route would push to until
  // the OS returned 410, which is a wasted notification.
  try {
    const { error } = await client
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId);
    if (error) return { ok: false, reason: "delete-failed" };
  } catch {
    return { ok: false, reason: "delete-failed" };
  }

  // Local-side: drop any active subscription so the OS / browser releases
  // the channel. Errors here are non-fatal - the DB row is gone, the
  // daily route will never target this device again, and the next
  // subscribeToPush call will rebuild fresh.
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }
  } catch {
    // Swallow - DB state is authoritative.
  }

  return { ok: true };
}

/**
 * Reports whether the local PushManager already has an active subscription
 * for this device. Used by the Settings UI to render the toggle in the
 * correct initial state without needing to round-trip to Supabase.
 */
export async function hasLocalSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription !== null;
  } catch {
    return false;
  }
}

/**
 * Outcome of a subscription reconciliation check.
 *
 * - `"in-sync"` - local subscription matches a server row; no action needed.
 * - `"re-inserted"` - local subscription existed but had no server row;
 *   the row was re-inserted successfully.
 * - `"disabled"` - local subscription existed but re-insert failed; the
 *   caller should flip the toggle off so the user knows reminders have stopped.
 * - `"no-local"` - no local subscription; nothing to reconcile.
 */
export type ReconcileResult =
  | "in-sync"
  | "re-inserted"
  | "disabled"
  | "no-local";

/**
 * Reconciles the local PushManager subscription against the server-side
 * `push_subscriptions` table (#1858 F35).
 *
 * When the push service rotates or expires a subscription the daily route
 * gets a 410 and deletes the server row, but the browser's PushManager still
 * reports `getSubscription() !== null`. `hasLocalSubscription()` therefore
 * returns true even though the server has no row - reminders silently stop
 * while Settings shows the toggle ON.
 *
 * This helper runs the full check:
 *   1. Get the local PushManager subscription. If absent, return `"no-local"`.
 *   2. Query `push_subscriptions` for the `(user_id, endpoint)` pair.
 *   3. If a row exists, return `"in-sync"`.
 *   4. If no row exists, re-insert the subscription keys (same delete-then-insert
 *      pattern as `subscribeToPush`) and return `"re-inserted"` on success or
 *      `"disabled"` on failure.
 *
 * The caller (PushOptIn) should flip the toggle off when `"disabled"` is
 * returned so the user can see that reminders have stopped and opt back in.
 *
 * RLS note: the SELECT and INSERT policies on `push_subscriptions` are keyed
 * on `auth.uid()`, so a user only sees and inserts their own rows.
 */
export async function reconcileSubscription(
  client: SupabaseClient,
  userId: string,
): Promise<ReconcileResult> {
  if (!isPushSupported()) return "no-local";
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return "no-local";

  let subscription: PushSubscription | null = null;
  try {
    const registration = await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.getSubscription();
  } catch {
    return "no-local";
  }
  if (!subscription) return "no-local";

  // Check for a matching server row.
  try {
    const { data, error } = await client
      .from("push_subscriptions")
      .select("endpoint")
      .eq("user_id", userId)
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();

    if (error) {
      // Query failed - treat as in-sync to avoid falsely disabling the toggle.
      return "in-sync";
    }
    if (data !== null) {
      // Row exists - all good.
      return "in-sync";
    }
  } catch {
    return "in-sync";
  }

  // No server row for the local subscription. Re-insert it.
  const p256dhBuf = subscription.getKey("p256dh");
  const authBuf = subscription.getKey("auth");
  if (!p256dhBuf || !authBuf) return "disabled";

  const p256dh = arrayBufferToBase64Url(p256dhBuf);
  const auth = arrayBufferToBase64Url(authBuf);

  try {
    // Delete-then-insert matches the pattern in subscribeToPush: there is no
    // UPDATE policy on push_subscriptions, so ON CONFLICT DO UPDATE would be
    // denied by RLS on re-insert.
    await client
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", subscription.endpoint);

    const { error: insertError } = await client
      .from("push_subscriptions")
      .insert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh,
        auth_secret: auth,
        last_seen_at: new Date().toISOString(),
      });

    if (insertError) return "disabled";
    return "re-inserted";
  } catch {
    return "disabled";
  }
}

/**
 * Encodes an ArrayBuffer as base64url (no padding) - the canonical
 * encoding for VAPID keys both on the wire and in storage. The web-push
 * library accepts this shape directly when sending.
 */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
