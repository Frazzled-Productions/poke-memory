---
kind: fixed
---
- Sync: stop stale clients from clobbering `user_settings` sub-objects (streakProtection, onboarding, earnedBadges). The LWW pull branch now snapshots the applied settings so the next push sees a zero diff; first-push default-pruning prevents a fresh device from overwriting richer cloud values with defaults.
