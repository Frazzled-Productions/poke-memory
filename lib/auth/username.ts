/**
 * Username/password auth helpers (#1671).
 *
 * Supabase Auth only supports email or phone as the login identifier, so
 * username-based accounts use a synthetic email address that is derived
 * deterministically from the normalised username. The synthetic email is
 * NEVER shown to the user.
 *
 * Security notes:
 *   - The INTERNAL_DOMAIN constant points to a domain that receives no mail.
 *     It is intentionally non-routable; any delivery attempt simply bounces.
 *   - Username enumeration on sign-up is an accepted trade-off: the
 *     `usernames` table SELECT policy is intentionally open so that "username
 *     already taken?" checks work before a session exists. This is documented
 *     in the PR body (#1671).
 *   - Passwords are passed directly to Supabase's signUp / signInWithPassword;
 *     they are never logged or stored by application code.
 */

/** Domain used to construct synthetic emails. Receives no real mail. */
export const INTERNAL_DOMAIN = "users.noreply.pokememory.internal";

/**
 * The valid username pattern: 3-30 characters, lowercase letters, digits,
 * underscores, and hyphens only. Must match the DB CHECK constraint.
 */
export const USERNAME_PATTERN = /^[a-z0-9_-]{3,30}$/;

/** Minimum password length. */
export const MIN_PASSWORD_LENGTH = 8;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a raw username input:
 *   - trims leading/trailing whitespace
 *   - converts to lowercase
 *
 * Returns the normalised string. Does NOT validate; call `validateUsername`
 * separately if you need to surface an error.
 */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type UsernameError =
  | "username_too_short"
  | "username_too_long"
  | "username_invalid_chars";

/**
 * Validates a normalised username string against the allowed format.
 * Returns `null` when valid, or an error key when invalid.
 *
 * The normalised value must already be lowercase and trimmed (call
 * `normaliseUsername` first).
 */
export function validateUsername(normalised: string): UsernameError | null {
  if (normalised.length < 3) return "username_too_short";
  if (normalised.length > 30) return "username_too_long";
  if (!USERNAME_PATTERN.test(normalised)) return "username_invalid_chars";
  return null;
}

// ---------------------------------------------------------------------------
// Synthetic email
// ---------------------------------------------------------------------------

/**
 * Derives the synthetic email address from a normalised username.
 *
 * The email is a stable, deterministic transformation:
 *   `${normalisedUsername}@${INTERNAL_DOMAIN}`
 *
 * The caller is responsible for normalising the username before calling this.
 * The resulting address is NEVER shown to the user.
 */
export function syntheticEmail(normalisedUsername: string): string {
  return `${normalisedUsername}@${INTERNAL_DOMAIN}`;
}
