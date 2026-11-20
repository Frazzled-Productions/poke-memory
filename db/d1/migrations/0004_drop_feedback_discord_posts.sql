-- Drops feedback_discord_posts (0001, from Postgres 051). It held the Discord message id of each bug
-- report's notification, so the post could be deleted with its feedback. Fraser's ruling of
-- 20 November 2026 replaced the Discord notification and digest with emails to the company mailbox
-- (lib/feedback/alerts.ts), which leave nothing to look up, so the table has no use. It held a
-- feedback id, a Discord message id and a timestamp: no user id and no message text.
DROP TABLE feedback_discord_posts;
