---
kind: changed
---
- Mastery now uses FSRS stability (>= 21 days) instead of the old `reps >= 3` sub-gate. Cards that had reached a large interval via an early Easy grade but were stuck waiting for a third review now correctly count as mastered. A lapse that drops stability below 21 reverts a species to learning; earned gym badges are unaffected.
