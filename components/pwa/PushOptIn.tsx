"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  hasLocalSubscription,
  isPushSupported,
  isStandalone,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/subscribe";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { cardPanelPadded, mutedTextXs } from "@/lib/utils/class-names";

/**
 * Daily-reminder opt-in toggle (#1056).
 *
 * Rendered inside the Settings page's "Account & Data" category but kept
 * as a self-contained component so its many gating conditions don't bleed
 * into the parent page. It renders only when ALL of:
 *
 *   - the user is authenticated (no cloud row to attach a subscription to
 *     for guests, and no daily route to fan out from)
 *   - push is supported in the current browser
 *   - the document is running as an installed PWA (display-mode standalone
 *     on Chromium; navigator.standalone on iOS). iOS specifically refuses
 *     to create push subscriptions outside of an installed app; showing a
 *     toggle that always fails is worse than hiding it.
 *
 * When any of those is false we render nothing - the parent's collapsible
 * section is unaffected and shows the other Account & Data controls as
 * normal.
 *
 * Superuser write-guard: while any superuser flag is on, all cloud writes
 * are suppressed (see AGENTS.md "Sync write-guard"). The toggle reflects
 * this by disabling itself with the same "Sync paused (superuser)" label
 * used by FsrsOptimizerSection and the delete-account button.
 */

type Status = "loading" | "ready" | "subscribing" | "unsubscribing";
type ErrorReason =
  | "permission-denied"
  | "unsupported"
  | "no-vapid-key"
  | "subscribe-failed"
  | "persist-failed"
  | "delete-failed";

export function PushOptIn({
  user,
  supabase,
}: {
  user: User;
  supabase: SupabaseClient;
}) {
  const t = useTranslations("settings.pushOptIn");
  const { anyFlagOn } = useSuperuser();
  const [visible, setVisible] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<ErrorReason | null>(null);

  // Gate detection runs on mount. The three checks are all sync (or fast
  // async) so the loading window is essentially the first paint after
  // hydration; the parent renders a placeholder via `visible === false`.
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      const supported = isPushSupported();
      const standalone = isStandalone();
      const shouldRender = supported && standalone;
      if (!cancelled) setVisible(shouldRender);
      if (!shouldRender) {
        setStatus("ready");
        return;
      }
      if (typeof Notification !== "undefined") {
        setPermission(Notification.permission);
      }
      const local = await hasLocalSubscription();
      if (!cancelled) {
        setSubscribed(local);
        setStatus("ready");
      }
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubscribe = useCallback(async () => {
    if (anyFlagOn) return;
    setStatus("subscribing");
    setError(null);
    const result = await subscribeToPush(supabase, user.id);
    if (typeof Notification !== "undefined") {
      setPermission(Notification.permission);
    }
    if (result.ok) {
      setSubscribed(true);
    } else {
      setError(result.reason);
    }
    setStatus("ready");
  }, [anyFlagOn, supabase, user.id]);

  const onUnsubscribe = useCallback(async () => {
    if (anyFlagOn) return;
    setStatus("unsubscribing");
    setError(null);
    const result = await unsubscribeFromPush(supabase, user.id);
    if (result.ok) {
      setSubscribed(false);
    } else {
      setError(result.reason);
    }
    setStatus("ready");
  }, [anyFlagOn, supabase, user.id]);

  if (!visible) return null;

  const busy = status === "subscribing" || status === "unsubscribing";
  const permissionDenied = permission === "denied";

  return (
    <div
      id="push-reminders-heading"
      className={cardPanelPadded}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">
            Daily review reminder
          </p>
          <p className={`mt-1 ${mutedTextXs}`}>
            Send a Web Push notification once a day when you have Pokémon ready to review. You can turn this off any time.
          </p>
        </div>
        {anyFlagOn ? (
          <button
            type="button"
            disabled
            data-testid="push-optin-button"
            title="Notifications are paused while a superuser flag is on."
            className="min-h-[36px] shrink-0 rounded-md bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          >
            Sync paused (superuser)
          </button>
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={subscribed}
            aria-label={t("ariaLabel")}
            disabled={busy || permissionDenied}
            data-testid="push-optin-button"
            onClick={() => {
              if (subscribed) {
                void onUnsubscribe();
              } else {
                void onSubscribe();
              }
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              subscribed
                ? "bg-foreground"
                : "bg-zinc-300 dark:bg-zinc-600"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                subscribed ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>
      {permissionDenied && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          Notifications are blocked for this app. To turn them on, open
          Settings on your device, find Poké Memory under Notifications, and
          enable Allow Notifications.
        </p>
      )}
      {error !== null && !permissionDenied && (
        <p
          role="alert"
          className="mt-3 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error === "permission-denied"
            ? "Permission was not granted."
            : error === "no-vapid-key"
              ? "Push notifications are not configured for this build."
              : error === "subscribe-failed"
                ? "Could not subscribe. Please try again."
                : error === "persist-failed"
                  ? "Subscribed locally but could not save. Please try again."
                  : error === "delete-failed"
                    ? "Could not unsubscribe. Please try again."
                    : "Notifications are not supported on this device."}
        </p>
      )}
    </div>
  );
}
