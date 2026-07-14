---
kind: changed
issue: 1906
---
- Extracted the bearer-token authorisation check duplicated across three API routes into a single shared helper (`lib/auth/bearerAuth.ts`); no behaviour change.
