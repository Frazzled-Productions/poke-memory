"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { reconcileVapidKey } from "@/lib/push/subscribe";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useSignInPull } from "@/lib/sync/useSignInPull";

/**
 * Renders nothing. Mounted in the root layout so the sign-in pull runs once
 * on every cold load (when already authenticated) and on every fresh sign-in.
 * Parallel to <SyncOnVisible /> - same architecture, different trigger.
 *
 * Also moves this browser's push subscription onto the current VAPID key,
 * once per load per signed-in user (reconcileVapidKey; the key pair is new
 * since the move to Cloudflare). Skipped while a superuser flag is on: it
 * writes push_subscriptions rows.
 */
export function SignInPull() {
  const { user, db } = useAuth();
  const { anyFlagOn } = useSuperuser();
  // Mirror the OnlineReconnectSync pattern: pulls are allowed while superuser
  // flags are on, but the push-back inside pullAndMerge must be suppressed.
  useSignInPull(db, user?.id ?? null, anyFlagOn);

  const userId = user?.id ?? null;
  const vapidCheckedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!db || !userId || anyFlagOn || vapidCheckedFor.current === userId) return;
    vapidCheckedFor.current = userId;
    void reconcileVapidKey(db, userId).catch(() => {});
  }, [db, userId, anyFlagOn]);

  return null;
}
