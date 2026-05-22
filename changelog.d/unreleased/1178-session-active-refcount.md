---
kind: fixed
---
- Fixed a sync glitch where closing one of two open practice tabs could allow a background cloud pull to fire in the remaining tab mid-session. The session-active flag is now a reference count so both tabs must close before background sync resumes.
