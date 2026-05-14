---
kind: fixed
---
- `streak_days` now rejects inserts with `review_date` more than one day in the future at the database layer, preventing a buggy client from inflating the streak. The `+1` grace window accommodates UTC+14 clients whose local "today" can be ahead of UTC.
