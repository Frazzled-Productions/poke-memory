/**
 * Cross-user database work for the scheduled jobs, the push sends, the
 * Discord notifications and the feedback route (decision 0018, design D4).
 * Each function does one named job; nothing here takes a session.
 *
 * Per-user requests use forUser (lib/db/scope.ts) instead. ESLint
 * (no-restricted-imports in eslint.config.mjs) only lets app/api/cron/**,
 * app/api/push/send-*, app/api/discord/**, app/api/feedback/** and lib/db
 * import this module.
 */
export {
  getPushTargets,
  getPushDueCards,
  getPushStreakDays,
  deleteDeadPushSubscriptions,
  type PushTargetRow,
  type PushDueCardRow,
  type PushStreakDayRow,
} from "./system/push";
export {
  insertFeedback,
  deleteFeedbackCreatedBefore,
  feedbackRetentionCutoff,
  feedbackForDigest,
  discordPostsForUser,
  discordPostStore,
  type FeedbackCategory,
  type NewFeedback,
} from "./system/feedback";
export {
  checkRateLimit,
  deleteExpiredRateLimitBuckets,
  RATE_LIMIT_CAPS,
  RATE_LIMIT_RETENTION_MS,
  type RateLimitedAction,
} from "./system/rateLimit";
export { reconcileGradeLogOrphans, RECONCILE_LIMIT, type ReconcileResult } from "./system/gradeLog";
export { backupTables, readTablePages, BACKUP_TABLE_ORDER } from "./system/backup";
