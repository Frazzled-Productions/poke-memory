/**
 * Better Auth's browser client (design D6), talking to /api/auth on the same
 * origin. Sign-in, sign-up, sign-out, the session hook and account linking.
 */
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({ plugins: [usernameClient()] });
