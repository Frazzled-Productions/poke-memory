"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { useVisibilityPull } from "@/lib/sync/useVisibilityPull";

/**
 * Renders nothing. Mounts the useVisibilityPull hook in the layout so it
 * runs on every page without bloating any specific page component.
 * Must be wrapped in <Suspense> at the call site (usePathname requirement).
 */
export function SyncOnVisible() {
  const { user, supabase } = useAuth();
  const pathname = usePathname();
  useVisibilityPull(supabase, user?.id ?? null, pathname);
  return null;
}
