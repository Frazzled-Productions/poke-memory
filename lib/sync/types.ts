import type { SavedSession } from "@/lib/review/persistence";
import type { StreakData } from "@/lib/streak/types";
import type { UserSettings } from "@/lib/settings/persistence";

export type { SavedSession, StreakData, UserSettings };

export type CloudSyncPayload = {
  session: SavedSession;
  streak: StreakData;
  settings: UserSettings;
  syncedAt: string; // ISO timestamp
};

export type ConflictResolution = "local" | "cloud";
