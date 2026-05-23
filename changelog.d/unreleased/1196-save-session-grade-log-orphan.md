---
kind: fixed
---
- Stopped recording grade-log entries when the session cards blob fails to persist, preventing a split-write where the grade log advanced past the saved session.
