/**
 * Sign-in, sign-up and sign-out from the browser, through Better Auth's client
 * (design D6). These were Supabase server actions; the per-IP throttle now
 * runs on the server in Better Auth's before hook (lib/auth/server.ts) and
 * comes back here as the RATE_LIMITED error code.
 *
 * IMPORTANT: passwords are never logged. Do not add logging that captures them.
 */
import { authClient } from "./client";
import type { AuthProvider } from "./types";
import { normaliseUsername, validateUsername, syntheticEmail, MIN_PASSWORD_LENGTH } from "./username";

/** Error code of the server's per-IP throttle (RATE_LIMITED_CODE in server.ts). */
const RATE_LIMITED = "RATE_LIMITED";

type ClientError = { status?: number; code?: string } | null | undefined;

const isRateLimited = (error: ClientError) => error?.code === RATE_LIMITED || error?.status === 429;

/**
 * Starts a GitHub or Google sign-in: the browser goes to the provider, back to
 * /api/auth/callback/<provider>, then to /auth/callback-complete, which sorts
 * the first arrival by what data exists. Failures land on /?error=<code>.
 */
export async function signIn(provider: AuthProvider): Promise<void> {
  if (provider !== "github" && provider !== "google") return;
  await authClient.signIn.social({
    provider,
    callbackURL: "/auth/callback-complete",
    errorCallbackURL: "/",
  });
}

/**
 * Signs out on every device, as Supabase's signOut did: revokes all of the
 * user's sessions, clears this browser's cookie, then reloads the home page.
 */
export async function signOut(): Promise<void> {
  await authClient.revokeSessions().catch(() => undefined);
  await authClient.signOut().catch(() => undefined);
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload clears signed-in state everywhere, as the old server redirect did
  window.location.assign("/");
}

// ---------------------------------------------------------------------------
// Username/password sign-up
// ---------------------------------------------------------------------------

export type SignUpWithUsernameResult =
  | { ok: true }
  | { ok: false; error: "username_too_short" | "username_too_long" | "username_invalid_chars" | "password_too_short" | "username_taken" | "signup_failed" | "rate_limited" };

/**
 * Signs up a new user with a username + password. The account's email is the
 * synthetic one derived from the normalised username (never shown); the
 * username lives on the Better Auth user (username column).
 *
 * "Taken" comes from either of two signals: the username plugin's
 * USERNAME_IS_ALREADY_TAKEN, or the unique synthetic email (USER_ALREADY_EXISTS
 * and its variants), which can only clash for the same username.
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

  const { data, error } = await authClient.signUp.email({
    email: syntheticEmail(normalised),
    password,
    name: normalised,
    username: normalised,
  });

  if (error) {
    if (isRateLimited(error)) return { ok: false, error: "rate_limited" };
    const code = error.code ?? "";
    const taken = code === "USERNAME_IS_ALREADY_TAKEN" || code.startsWith("USER_ALREADY_EXISTS");
    return { ok: false, error: taken ? "username_taken" : "signup_failed" };
  }

  if (!data?.user?.id) {
    return { ok: false, error: "signup_failed" };
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
 * Signs in an existing user with a username + password. One answer for an
 * unknown username and a wrong password.
 */
export async function signInWithUsername(
  rawUsername: string,
  password: string,
): Promise<SignInWithUsernameResult> {
  const normalised = normaliseUsername(rawUsername);
  if (validateUsername(normalised)) {
    return { ok: false, error: "invalid_credentials" };
  }

  const { error } = await authClient.signIn.username({ username: normalised, password });

  if (error) {
    return { ok: false, error: isRateLimited(error) ? "rate_limited" : "invalid_credentials" };
  }

  return { ok: true };
}
