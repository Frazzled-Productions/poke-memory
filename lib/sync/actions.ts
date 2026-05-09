'use server';

import { auth } from "@/auth";
import { Redis } from "@upstash/redis";
import type { CloudSyncPayload, ConflictResolution } from "@/lib/sync/types";

// Inline client — avoids exporting a Redis singleton that Next.js might bundle on the edge
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function syncKey(userId: string): string {
  return `sync:${userId}`;
}

export async function loadCloudSync(): Promise<CloudSyncPayload | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const data = await redis.get<CloudSyncPayload>(syncKey(session.user.id));
  return data ?? null;
}

export async function saveCloudSync(payload: CloudSyncPayload): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  await redis.set(syncKey(session.user.id), payload);
}

export async function resolveConflict(
  resolution: ConflictResolution,
  localPayload: CloudSyncPayload,
): Promise<CloudSyncPayload> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Session expired — please sign in again before resolving a sync conflict.');
  }

  if (resolution === 'local') {
    await redis.set(syncKey(session.user.id), localPayload);
    return localPayload;
  }

  const cloudData = await redis.get<CloudSyncPayload>(syncKey(session.user.id));
  return cloudData ?? localPayload;
}
