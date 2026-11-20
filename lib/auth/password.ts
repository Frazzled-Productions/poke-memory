/**
 * Password verification for Better Auth (design D6). Supabase stored bcrypt
 * hashes; the data copy moves them into account.password unchanged. Verify
 * accepts those as well as Better Auth's own scrypt hashes, and after a
 * successful bcrypt sign-in lib/auth/server.ts rehashes the password with
 * scrypt, so bcrypt hashes fade out.
 *
 * Passwords are never logged.
 */
import bcrypt from "bcryptjs";
import { verifyPassword as verifyScrypt } from "better-auth/crypto";

/** True for a bcrypt hash ($2a$, $2b$ or $2y$), the format Supabase used. */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

/** Better Auth `emailAndPassword.password.verify`: bcrypt or scrypt. */
export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (isBcryptHash(hash)) return bcrypt.compare(password, hash);
  return verifyScrypt({ hash, password });
}
