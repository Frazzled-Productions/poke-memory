---
kind: changed
---
- DB now rejects out-of-range `stability` or `difficulty` values on `card_reviews` with a constraint violation rather than silently storing them.
