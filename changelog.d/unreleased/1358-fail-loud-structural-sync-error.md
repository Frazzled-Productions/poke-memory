---
kind: fixed
---
- Structural sync errors on the card_reviews primary path (SQLSTATE 42P10 ON CONFLICT mismatch, and other schema errors) now surface in the Stats page sync banner immediately instead of being swallowed silently. The banner reads "Sync error: a schema mismatch was detected. Your progress is safe locally." and has no Retry button, since retrying a schema mismatch always fails. Previously, these errors were logged only as console.warn and were indistinguishable from transient network failures — the root cause of the 19-hour silent outage in #1344.
