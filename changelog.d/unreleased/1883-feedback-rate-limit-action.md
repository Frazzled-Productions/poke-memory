---
kind: fixed
---

- Feedback submission no longer fails with 429/500 for all users: added 'feedback' action to check_rate_limit (migration 045) and made the route fail-open on RPC errors rather than treating them as rate-limit blocks (#1883)
