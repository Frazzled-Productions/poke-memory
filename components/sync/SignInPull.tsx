"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useSignInPull } from "@/lib/sync/useSignInPull";

/**
 * Renders nothing. Mounted in the root layout so the sign-in pull runs once
 * on every cold load (when already authenticated) and on every fresh sign-in.
 * Parallel to <SyncOnVisible /> - same architecture, different trigger.
 */
export function SignInPull() {
  const { user, supabase } = useAuth();
  const { anyFlagOn } = useSuperuser();
  // Mirror the OnlineReconnectSync pattern: pulls are allowed while superuser
  // flags are on, but the push-back inside pullAndMerge must be suppressed.
  useSignInPull(supabase, user?.id ?? null, anyFlagOn);
  return null;
}
