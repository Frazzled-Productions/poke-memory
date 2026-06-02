"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { useSuperuser } from "@/lib/superuser/SuperuserContext";
import { useVisibilityPull } from "@/lib/sync/useVisibilityPull";

/**
 * Renders nothing. Mounts the useVisibilityPull hook in the layout so it
 * runs on every page without bloating any specific page component.
 * Must be wrapped in <Suspense> at the call site (usePathname requirement).
 */
export function SyncOnVisible() {
  const { user, supabase } = useAuth();
  const { anyFlagOn } = useSuperuser();
  const pathname = usePathname();
  // Mirror the OnlineReconnectSync pattern: pulls are allowed while superuser
  // flags are on, but the push-back inside pullAndMerge must be suppressed.
  useVisibilityPull(supabase, user?.id ?? null, pathname, anyFlagOn);
  return null;
}
