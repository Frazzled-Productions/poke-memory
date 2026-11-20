/**
 * Cross-user database work for the scheduled jobs, the push sends, the
 * feedback route and the public user count
 * (decision 0018, design D4 and D13).
 * Each function does one named job; nothing here takes a session.
 *
 * Per-user requests use forUser (lib/db/scope.ts) instead. ESLint
 * (no-restricted-imports in eslint.config.mjs) only lets app/api/cron/**,
 * app/api/push/send-*, app/api/feedback/**,
 * app/api/stats/users and lib/db import this module.
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
  feedbackMessage,
  type FeedbackCategory,
  type NewFeedback,
} from "./system/feedback";
export { checkRateLimit, RATE_LIMIT_CAPS } from "./rateLimit";
export { deleteExpiredRateLimitBuckets, RATE_LIMIT_RETENTION_MS } from "./system/rateLimit";
export { reconcileGradeLogOrphans, RECONCILE_LIMIT, type ReconcileResult } from "./system/gradeLog";
export { backupTables, readTablePages, BACKUP_TABLE_ORDER } from "./system/backup";
export {
  checkGradeLogDivergence,
  divergenceReport,
  divergenceSummary,
  type DivergenceResult,
} from "./system/gradeLogDivergence";
export { countUsers } from "./system/stats";
