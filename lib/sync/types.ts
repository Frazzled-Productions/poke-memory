export type CloudSyncPayload = {
  session: import('@/lib/review/persistence').SavedSession;
  streak: import('@/lib/streak/types').StreakData;
  settings: import('@/lib/settings/persistence').UserSettings;
  syncedAt: string; // ISO timestamp
};

export type ConflictResolution = 'local' | 'cloud';
