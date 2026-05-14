---
kind: fixed
---
- DB regression trigger now rejects `card_reviews` updates that drop `scheduled_days` when `last_review` didn't advance, blocking same-day stale-state clobbers without breaking real Again grades.
