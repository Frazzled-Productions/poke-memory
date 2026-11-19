/**
 * Whether this deployment may send anything to real people or channels (Web
 * Push, Discord). Only production may: the preview Worker's database holds
 * rehearsal copies of real data, so it must never message anyone (design D2).
 * Unknown or missing DEPLOY_ENV (local dev, tests) is treated as "no".
 */
export function outboundAllowed(env: { DEPLOY_ENV?: string }): boolean {
  return env.DEPLOY_ENV === "cloudflare-production";
}
