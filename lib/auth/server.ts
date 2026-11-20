/**
 * Better Auth on D1 (decision 0018, design D6). Server code only.
 *
 *   const auth = await getAuth();                       // this request's Worker env
 *   const session = await auth.api.getSession({ headers: request.headers });
 *
 * Built per request from the D1 binding (Better Auth's Kysely adapter detects
 * D1 and uses its D1 dialect). Sign-in methods: username plus password (the
 * username plugin, with the synthetic email from lib/auth/username.ts), GitHub
 * and Google, linkable to one another.
 *
 * Privacy: sessions keep no IP address or user agent, and OAuth access,
 * refresh and id tokens are not stored (the app never calls the providers'
 * APIs). The per-IP throttle reads CF-Connecting-IP for the moment of the
 * check and stores only its salted hash, as before (lib/db/rateLimit.ts).
 */
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";
import { getEnv, type AppEnv } from "@/lib/db/env";
import { checkRateLimit } from "@/lib/db/rateLimit";
import { isBcryptHash, verifyPassword } from "./password";
import { hashIp, type RateLimitAction } from "./rateLimitIp";
import { MIN_PASSWORD_LENGTH, USERNAME_PATTERN, normaliseUsername, syntheticEmail } from "./username";

export type AuthEnv = Pick<
  AppEnv,
  | "DB"
  | "BETTER_AUTH_URL"
  | "BETTER_AUTH_SECRET"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "RATE_LIMIT_SALT"
> &
  Partial<Pick<AppEnv, "DEPLOY_ENV">>;

/** Better Auth endpoints behind the per-IP throttle, and their bucket. */
const THROTTLED_PATHS: Readonly<Record<string, RateLimitAction>> = {
  "/sign-up/email": "signup",
  "/sign-in/username": "signin",
  "/sign-in/email": "signin",
};

/** Error code the client maps to "rate_limited" (lib/auth/actions.ts). */
export const RATE_LIMITED_CODE = "RATE_LIMITED";

/** OAuth tokens are dropped before an account row is written. */
function withoutOAuthTokens<T extends Record<string, unknown>>(account: T): T {
  return { ...account, accessToken: null, refreshToken: null, idToken: null };
}

/**
 * The GitHub login as the display username (Better Auth keeps only the
 * profile's name, email and avatar). It is the handle on the Journey trainer
 * card (user_metadata.user_name, lib/auth/types.ts), as it was under the old
 * auth. Only used when Better Auth creates a user from a GitHub sign-in, so
 * such a user has no username; the username plugin leaves a display username
 * without a username unchecked.
 */
export function githubProfileToUser(profile: { login?: string | null }): { displayUsername?: string } {
  return profile.login ? { displayUsername: profile.login } : {};
}

/** The preview Worker's base URL and its per-PR version aliases (design D11). */
const PREVIEW_BASE_ORIGIN = "https://poke-memory-preview.frasers-account.workers.dev";
const PREVIEW_ALIAS_ORIGIN = /^https:\/\/pr-\d+-poke-memory-preview\.frasers-account\.workers\.dev$/;

/**
 * Origins trusted besides BETTER_AUTH_URL's. Only on the preview Worker: its
 * base URL and the version alias the request came from
 * (https://pr-<n>-poke-memory-preview.frasers-account.workers.dev), so sign-in
 * works on a PR's own alias. Anywhere else, none.
 */
export function trustedOriginsFor(deployEnv: string | undefined): string[] | ((request?: Request) => string[]) {
  if (deployEnv !== "cloudflare-preview") return [];
  return (request?: Request) => {
    const origin = request?.headers.get("origin");
    return origin && PREVIEW_ALIAS_ORIGIN.test(origin) ? [PREVIEW_BASE_ORIGIN, origin] : [PREVIEW_BASE_ORIGIN];
  };
}

export function createAuth(env: AuthEnv) {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set");
  return betterAuth({
    database: env.DB as never,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: trustedOriginsFor(env.DEPLOY_ENV),
    // Supabase sessions did not lapse; Better Auth's default ends one after 7
    // days without a visit. A year, renewed at most once a day of use.
    session: { expiresIn: 365 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Copied Supabase accounts carry bcrypt hashes (see lib/auth/password.ts).
      password: { verify: verifyPassword },
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 30,
        // The plugin lower-cases usernames; the rule is the app's USERNAME_PATTERN.
        usernameValidator: (value: string) => USERNAME_PATTERN.test(value.toLowerCase()),
      }),
    ],
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID ?? "",
        clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
        mapProfileToUser: githubProfileToUser,
      },
      google: { clientId: env.GOOGLE_CLIENT_ID ?? "", clientSecret: env.GOOGLE_CLIENT_SECRET ?? "" },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["github", "google"],
        // Username accounts carry a synthetic email, so a linked provider's differs.
        allowDifferentEmails: true,
      },
    },
    // OAuth failures land on the home page as /?error=<code>, which shows the
    // sign-in failed banner (app/page.tsx).
    onAPIError: { errorURL: new URL("/", env.BETTER_AUTH_URL).toString() },
    advanced: {
      // Same shape as the user ids copied from Supabase.
      database: { generateId: () => crypto.randomUUID() },
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      session: {
        create: { before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }) },
      },
      account: {
        create: { before: async (account) => ({ data: withoutOAuthTokens(account) }) },
        update: { before: async (account) => ({ data: withoutOAuthTokens(account) }) },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const action = THROTTLED_PATHS[ctx.path];
        if (!action) return;
        const ip = ctx.headers?.get("cf-connecting-ip") ?? "unknown";
        let allowed: boolean;
        try {
          allowed = await checkRateLimit(env.DB, hashIp(ip, env.RATE_LIMIT_SALT), action);
        } catch {
          allowed = false; // Fail closed, as the old RPC error path did.
        }
        if (!allowed) {
          throw new APIError("TOO_MANY_REQUESTS", {
            code: RATE_LIMITED_CODE,
            message: "Too many attempts. Try again later.",
          });
        }
        // Password sign-up is for username accounts only: the email must be
        // the synthetic one derived from the username, never a real address.
        if (ctx.path === "/sign-up/email") {
          const body = (ctx.body ?? {}) as { email?: unknown; username?: unknown };
          if (
            typeof body.username !== "string" ||
            body.email !== syntheticEmail(normaliseUsername(body.username))
          ) {
            throw new APIError("BAD_REQUEST", { code: "USERNAME_REQUIRED", message: "Sign up with a username." });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // After a password sign-in against a copied bcrypt hash, store scrypt instead.
        if (ctx.path !== "/sign-in/username" && ctx.path !== "/sign-in/email") return;
        const userId = ctx.context.newSession?.user.id;
        const password = (ctx.body as { password?: unknown } | undefined)?.password;
        if (!userId || typeof password !== "string") return;
        try {
          const account = await ctx.context.internalAdapter.findCredentialAccount(userId);
          if (account?.password && isBcryptHash(account.password)) {
            await ctx.context.internalAdapter.updatePassword(userId, await ctx.context.password.hash(password));
          }
        } catch (err) {
          // The sign-in stands; the rehash is retried on the next one.
          ctx.context.logger.error("bcrypt rehash failed", err instanceof Error ? err.message : err);
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Better Auth for this request's Worker env (or the env given, in tests). */
export async function getAuth(env?: AuthEnv): Promise<Auth> {
  return createAuth(env ?? (await getEnv()));
}
