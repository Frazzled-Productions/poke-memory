import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// Returns a Supabase client for use in browser (Client Component) contexts.
// The NEXT_PUBLIC_ prefix makes these env vars available on the client side.
// Guards against missing env vars during CI builds / static pre-rendering.
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createBrowserClient<Database>(url, key);
}
