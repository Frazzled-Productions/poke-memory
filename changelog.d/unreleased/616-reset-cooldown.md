---
kind: security
---
- Reject `reset_all_progress` calls that fire within 5 s of the previous one, blocking session-token replay attacks and accidental double-fires.
