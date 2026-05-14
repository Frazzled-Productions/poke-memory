---
kind: changed
---
- Internal: signed-in destructive reset goes through a new `resetAllProgressEverywhere` orchestrator that wipes cloud first, then local, atomically. `clearLocalProgress` is now flagged in code as the guest-only path; signed-in callers using it directly would let the next sync push resurrect the cloud rows.
