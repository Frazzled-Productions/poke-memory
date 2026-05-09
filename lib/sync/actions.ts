'use server';

import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import type { CloudSyncPayload, ConflictResolution } from "@/lib/sync/types";

// Inline client to avoid circular import through lib/sync/redis.ts
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function syncKey(userId: string): string {
  return `sync:${userId}`;
}

/**
 * Load cloud sync data for the authenticated user.
 * Returns null if not signed in or no data exists in the store.
 */
export async function loadCloudSync(): Promise<CloudSyncPayload | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const data = await redis.get<CloudSyncPayload>(syncKey(session.user.id));
  return data ?? null;
}

/**
 * Save cloud sync data for the authenticated user.
 * No-op if not signed in.
 */
export async function saveCloudSync(payload: CloudSyncPayload): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  await redis.set(syncKey(session.user.id), payload);
}

/**
 * Resolve a conflict between local and cloud data.
 *
 * "local"  → uploads the local payload to the cloud and returns it.
 * "cloud"  → cloud data is already correct; returns it as-is (no write).
 */
export async function resolveConflict(
  resolution: ConflictResolution,
  localPayload: CloudSyncPayload,
): Promise<CloudSyncPayload> {
  const session = await auth();
  if (!session?.user?.id) {
    // Not authenticated — fall back to whatever the caller passed.
    return localPayload;
  }

  if (resolution === "local") {
    await redis.set(syncKey(session.user.id), localPayload);
    return localPayload;
  }

  // resolution === "cloud": return what's in the store.
  const cloudData = await redis.get<CloudSyncPayload>(syncKey(session.user.id));
  // Guard: if cloud is somehow empty, fall back to local.
  return cloudData ?? localPayload;
}
