/**
 * The Worker's bindings and vars, typed (decision 0018). Server code only:
 * route handlers, server components and server actions.
 *
 *   const db = forUser(await getDb(), userId);   // lib/db/scope.ts
 *
 * Uses getCloudflareContext({ async: true }) so it also works where Next.js
 * renders outside a request (static generation); in `next dev` the bindings
 * come from wrangler.jsonc through initOpenNextCloudflareForDev (next.config.ts).
 * Secrets are optional in the type: an unset secret is a deployment error the
 * reading code must report, not a type error.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1DatabaseLike, R2BucketLike } from "./d1";

export type DeployEnv = "cloudflare-production" | "cloudflare-preview";

export interface AppEnv {
  /** D1: poke-memory (production) or poke-memory-preview. */
  DB: D1DatabaseLike;
  /** R2 (EU): poke-memory-backups or poke-memory-backups-preview (design D10). */
  BACKUPS: R2BucketLike;
  /** Gate outbound sends with outboundAllowed() in lib/outbound.ts. */
  DEPLOY_ENV: DeployEnv | (string & {});
  BETTER_AUTH_URL: string;
  // Secrets (wrangler secret put; list in wrangler.jsonc).
  BETTER_AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  CRON_SHARED_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  DISCORD_NOTIFY_WEBHOOK_URL?: string;
  DISCORD_DIGEST_WEBHOOK_URL?: string;
  RATE_LIMIT_SALT?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
}

/** The current request's Worker env. Throws when there is no D1 binding. */
export async function getEnv(): Promise<AppEnv> {
  const { env } = await getCloudflareContext({ async: true });
  const appEnv = env as unknown as Partial<AppEnv>;
  if (!appEnv.DB) {
    throw new Error("No D1 binding `DB`: run on the Worker (wrangler) or `next dev` with wrangler.jsonc");
  }
  return appEnv as AppEnv;
}

/** The D1 database. Wrap it with forUser() before touching per-user rows. */
export async function getDb(): Promise<D1DatabaseLike> {
  return (await getEnv()).DB;
}
