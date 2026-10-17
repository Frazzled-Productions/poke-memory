// Supabase API keys, read in one place while we move off the legacy JWT keys (#2162).
//
// Supabase is removing the legacy `anon` and `service_role` keys (late 2026). The new keys are
// `sb_publishable_...` (replaces anon) and `sb_secret_...` (replaces service_role). Each getter
// prefers the new env var and falls back to the legacy one, so this ships before the env changes
// and keeps working while both are set. Remove the fallbacks once the legacy keys are disabled.
//
// NEXT_PUBLIC_* names are written out literally so Next.js can inline them into the browser bundle.

/** Low-privilege key for browser and SSR clients (RLS applies). */
export function supabasePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    undefined
  );
}

/** Server-only key that bypasses RLS. Never import this into client code. */
export function supabaseSecretKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    undefined
  );
}
