---
kind: changed
---
- Scheduler now uses FSRS via `ts-fsrs` instead of SM-2. Existing localStorage progress migrates automatically on first load — repetitions / interval / easeFactor become FSRS stability / difficulty / reps / lapses fields, keeping due dates and first-seen timestamps intact.
