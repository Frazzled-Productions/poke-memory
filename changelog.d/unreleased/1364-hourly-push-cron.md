---
kind: changed
---
- Push reminders now honour each user's chosen notification hour. The pg_cron job runs hourly and the per-user UTC hour gate (added in #1315) activates for all users. Users with no preference continue to receive their reminder at 08:00 UTC as before.
