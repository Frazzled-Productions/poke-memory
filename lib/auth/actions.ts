"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
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
 *   3. Call supabase.auth.signUp with the synthetic email + password.
 *      emailRedirectTo is omitted - email confirmation MUST be disabled in the
 *      Supabase dashboard ("Confirm email" toggle off) so the session is
 *      usable immediately without any email round-trip. See PR body for the
 *      one-off dashboard toggle the maintainer must flip.
 *   4. Insert the (username, user_id) row into public.usernames.
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

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Do NOT pass emailRedirectTo - the synthetic address cannot receive mail.
      // Email confirmation must be disabled in the Supabase dashboard.
      data: {
        // Store username in user_metadata for display purposes (does not
        // replace the primary lookup path through public.usernames).
        username: normalised,
      },
    },
  });

  if (signUpError) {
    // Use GoTrue's canonical signal for an already-registered email rather than
    // the human-readable message string, which can change across GoTrue versions.
    // `code === "email_exists"` is the primary signal; `identities.length === 0`
    // is the documented secondary indicator. Status 422 is GoTrue's general
    // "Unprocessable Entity" and is intentionally excluded: it can cover
    // non-duplicate rejections (e.g. a future password-strength rule) and would
    // mislead the user into changing their username instead of their password.
    // Cast signUpData.user via unknown so TS does not narrow 'identities' to
    // never in the error branch (the Supabase SDK types differ between the
    // error and success overloads of AuthResponse).
    const maybeUser = signUpData.user as { identities?: unknown[] } | null;
    const alreadyRegistered =
      (signUpError as { code?: string }).code === "email_exists" ||
      maybeUser?.identities?.length === 0;
    if (alreadyRegistered) {
      return { ok: false, error: "username_taken" };
    }
    return { ok: false, error: "signup_failed" };
  }

  const userId = signUpData.user?.id;
  if (!userId) {
    return { ok: false, error: "signup_failed" };
  }

  // If the Supabase dashboard has "Confirm email" enabled, the synthetic address
  // cannot receive a confirmation mail, so the session will be null even when
  // the auth.users row was created. Without a session there is no auth.uid(),
  // which means the INSERT into public.usernames will be rejected by RLS, leaving
  // an orphan auth.users row and surfacing a misleading "username_taken" error.
  // Return signup_failed here and let the user (or the admin) investigate the
  // dashboard misconfiguration rather than creating a confusing half-created account.
  if (!signUpData.session) {
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
