"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import { useSignInPull } from "@/lib/sync/useSignInPull";

/**
 * Renders nothing. Mounted in the root layout so the sign-in pull runs once
 * on every cold load (when already authenticated) and on every fresh sign-in.
 * Parallel to <SyncOnVisible /> — same architecture, different trigger.
 */
export function SignInPull() {
  const { user, supabase } = useAuth();
  useSignInPull(supabase, user?.id ?? null);
  return null;
}
