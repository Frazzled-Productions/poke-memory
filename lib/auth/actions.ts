"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthProvider } from "./types";
import { normaliseUsername, validateUsername, syntheticEmail, MIN_PASSWORD_LENGTH } from "./username";

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
  | { ok: false; error: string };

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

  const supabase = await createClient();
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
    // `user?.identities?.length === 0` is the documented indicator; the code/status
    // checks are a fallback for edge cases.
    // Cast signUpData.user via unknown so TS does not narrow 'identities' to
    // never in the error branch (the Supabase SDK types differ between the
    // error and success overloads of AuthResponse).
    const maybeUser = signUpData.user as { identities?: unknown[] } | null;
    const alreadyRegistered =
      maybeUser?.identities?.length === 0 ||
      (signUpError as { code?: string; status?: number }).code === "email_exists" ||
      (signUpError as { code?: string; status?: number }).status === 422;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any)
    .from("usernames")
    .insert({ username: normalised, user_id: userId });

  if (insertError) {
    // The username was claimed between sign-up and insert (race condition), or
    // RLS rejected the insert. Either way, present as "username taken".
    return { ok: false, error: "username_taken" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Username/password sign-in
// ---------------------------------------------------------------------------

export type SignInWithUsernameResult =
  | { ok: true }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const email = syntheticEmail(normalised);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { ok: false, error: "invalid_credentials" };
  }

  return { ok: true };
}
