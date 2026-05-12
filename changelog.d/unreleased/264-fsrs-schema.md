---
kind: changed
---
- Cloud sync now stores FSRS state directly (`stability`, `difficulty`, `reps`, `lapses`, `fsrs_state`) instead of legacy SM-2 fields. Existing cloud rows backfill automatically on the migration.
