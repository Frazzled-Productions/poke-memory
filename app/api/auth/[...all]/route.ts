/**
 * Better Auth's endpoints (design D6): sign-up, sign-in (username, GitHub,
 * Google), the OAuth callbacks at /api/auth/callback/<provider>, sessions,
 * account linking and sign-out.
 */
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";

export const { GET, POST } = toNextJsHandler(async (request: Request) => (await getAuth()).handler(request));
