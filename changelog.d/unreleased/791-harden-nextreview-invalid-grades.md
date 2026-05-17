---
kind: fixed
---
- Fixed an unguarded runtime error in the scheduler where an invalid grade (e.g. from a corrupted payload) could reach the FSRS engine and produce an opaque crash; `nextReview` now throws a descriptive `RangeError` immediately.
