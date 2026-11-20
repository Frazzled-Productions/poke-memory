import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db/env";
import { countUsers } from "@/lib/db/system";

/** How long Shields.io and browsers may keep the count (the old badge refreshed daily). */
const CACHE_SECONDS = 3600;

/**
 * GET /api/stats/users (design D13): the README user-count badge as Shields.io
 * endpoint JSON (https://shields.io/badges/endpoint-badge), read live from D1
 * by the Worker. It replaces the daily refresh-user-count workflow, which read
 * the production database from a GitHub runner and committed
 * .github/stats/users.json to main (owner ruling 20 November 2026).
 *
 * Public and unauthenticated: the number was already public on the badge, and
 * the answer is one aggregate. Cached for an hour by Shields.io (cacheSeconds)
 * and by Cache-Control, so the database sees at most a handful of COUNT(*)
 * reads an hour from the badge.
 */
export async function GET() {
  try {
    const count = await countUsers((await getEnv()).DB);
    return NextResponse.json(
      { schemaVersion: 1, label: "users", message: String(count), color: "blue", cacheSeconds: CACHE_SECONDS },
      { headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` } },
    );
  } catch (err) {
    console.error(`[stats/users] count failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
