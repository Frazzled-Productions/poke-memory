"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { supabaseSecretKey } from "@/lib/supabase/keys";
import type { AuthProvider } from "./types";
import { normaliseUsername, validateUsername, syntheticEmail, MIN_PASSWORD_LENGTH } from "./username";
import { hashIp } from "./rateLimitIp";
import type { RateLimitAction } from "./rateLimitIp";

export async function signIn(provider: AuthProvider) {
  if (provider !== "github" && provider !== "google") redirect("/");
  const supabase = await createClient();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: base + "/api/auth/callback",
    },
  });
  if (error || !data.url) redirect("/");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// ---------------------------------------------------------------------------
// Username/password sign-up
// ---------------------------------------------------------------------------

export type SignUpWithUsernameResult =
  | { ok: true }
  | { ok: false; error: "username_too_short" | "username_too_long" | "username_invalid_chars" | "password_too_short" | "username_taken" | "signup_failed" | "rate_limited" };

/**
 * Signs up a new user with a username + password.
 *
 * Steps:
 *   1. Normalise + validate the username.
 *   2. Derive the synthetic email (never shown to the user).
 *   3. Create the account with the admin API (secret key), already confirmed:
 *      the synthetic address cannot receive mail, and creating it here means
 *      this door works whichever way the Supabase "Confirm email" setting is set.
 *   4. Sign in with the same credentials, which sets the session cookie.
 *   5. Insert the (username, user_id) row into public.usernames.
 *
 * IMPORTANT: password is never logged. Do not add logging that captures it.
 */
export async function signUpWithUsername(
  rawUsername: string,
  password: string,
): Promise<SignUpWithUsernameResult> {
  const normalised = normaliseUsername(rawUsername);
  const usernameError = validateUsername(normalised);
  if (usernameError) {
    return { ok: false, error: usernameError };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "password_too_short" };
  }

  // Per-IP throttle: check before any GoTrue call to prevent account-creation
  // floods and username enumeration. Raw IP is never persisted; only the
  // salted sha256 hash is written to public.rate_limit_buckets via the RPC.
  const hdrs = await headers();
  const rawIp = (hdrs.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const ipHash = hashIp(rawIp);

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rlAllowed, error: rlError } = await (supabase as any).rpc(
    "check_rate_limit",
    { p_ip_hash: ipHash, p_action: "signup" as RateLimitAction },
  );
  if (rlError || rlAllowed === false) {
    return { ok: false, error: "rate_limited" };
  }

  const email = syntheticEmail(normalised);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = supabaseSecretKey();
  if (!supabaseUrl || !secretKey) {
    console.error("[sign-up] Supabase URL or secret key is not configured");
    return { ok: false, error: "signup_failed" };
  }
  const admin = createSupabaseAdminClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // Store username in user_metadata for display purposes (does not replace
    // the primary lookup path through public.usernames).
    user_metadata: { username: normalised },
  });

  if (createError) {
    // `email_exists` is GoTrue's canonical signal for an already-registered
    // address; the message string can change across versions.
    const alreadyRegistered = (createError as { code?: string }).code === "email_exists";
    if (alreadyRegistered) {
      return { ok: false, error: "username_taken" };
    }
    // Status and code only: the message can carry the synthetic email.
    console.error("[sign-up] createUser failed", createError.status, createError.code);
    return { ok: false, error: "signup_failed" };
  }

  const userId = created.user?.id;
  if (!userId) {
    return { ok: false, error: "signup_failed" };
  }

  // Without a session there is no auth.uid(), so the INSERT below would be
  // rejected by RLS. Remove the new user on failure: left behind, it would hold
  // the username with no way in.
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error("[sign-up] could not remove the new user", userId, deleteError.status, deleteError.code);
    }
    return { ok: false, error: "signup_failed" };
  }

  // Insert the username mapping. If the username row already exists (race),
  // the PRIMARY KEY constraint returns a conflict error.
  // Cast to any because Database is a stub (unknown) until types are generated
  // from the live schema. Safe: the migration defines the exact shape.
  // TODO: remove cast once `supabase gen types` is run after migration 035 is
  // applied (tracked in the post-merge checklist for #1671).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any)
    .from("usernames")
    .insert({ username: normalised, user_id: userId });

  if (insertError) {
    // Postgres code 23505 = unique_violation: the username was claimed in a
    // race (PK conflict) or the user already has a username (UNIQUE user_id
    // constraint). Any other failure (transient DB error, future CHECK
    // constraint) is surfaced as signup_failed so the user doesn't
    // unnecessarily change their chosen username.
    const isConflict = (insertError as { code?: string }).code === "23505";
    return { ok: false, error: isConflict ? "username_taken" : "signup_failed" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Username/password sign-in
// ---------------------------------------------------------------------------

export type SignInWithUsernameResult =
  | { ok: true }
  | { ok: false; error: "invalid_credentials" | "rate_limited" };

/**
 * Signs in an existing user with a username + password.
 *
 * Because the synthetic email is derived deterministically from the username,
 * no pre-session lookup against public.usernames is strictly required for
 * sign-in. The derivation alone is sufficient.
 *
 * IMPORTANT: password is never logged. Do not add logging that captures it.
 */
export async function signInWithUsername(
  rawUsername: string,
  password: string,
): Promise<SignInWithUsernameResult> {
  const normalised = normaliseUsername(rawUsername);
  const usernameError = validateUsername(normalised);
  if (usernameError) {
    return { ok: false, error: "invalid_credentials" };
  }

  // Per-IP throttle: looser cap for sign-in (10 / 10 min, 40 / 1 hr) since
  // a failed sign-in creates no account; still guards against credential stuffing.
  // TODO: apply check_rate_limit('signin'/'magiclink') when #1670 lands for the
  // magic-link door as well.
  const hdrs = await headers();
  const rawIp = (hdrs.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const ipHash = hashIp(rawIp);

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rlAllowed, error: rlError } = await (supabase as any).rpc(
    "check_rate_limit",
    { p_ip_hash: ipHash, p_action: "signin" as RateLimitAction },
  );
  if (rlError || rlAllowed === false) {
    return { ok: false, error: "rate_limited" };
  }

  const email = syntheticEmail(normalised);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { ok: false, error: "invalid_credentials" };
  }

  return { ok: true };
}
