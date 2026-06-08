---
kind: security
issue: 1768
---
- Add per-IP rate-limit throttle on username sign-up and sign-in Server Actions (migration 041): salted-hash IP bucketing via `public.check_rate_limit` SECURITY DEFINER RPC, 5 sign-up/10 min + 10 sign-in/10 min caps, raw IP never persisted; `rate_limited` error surfaced in all four locales.
