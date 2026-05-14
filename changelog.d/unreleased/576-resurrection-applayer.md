---
kind: fixed
---
- Sync: stale-local resurrection-on-reset is now caught at the app layer too. `pullAndMerge` reads `user_settings.last_reset_at` (the schema marker added in #582) on every cycle and calls `clearLocalProgress` before merging when the cloud marker has advanced past what this device last reconciled. So when you reset progress on one device, the others now wipe their local state on the next sync — they no longer push pre-reset cards/streak/grades back into cloud, even before the DB-layer triggers would reject them.
