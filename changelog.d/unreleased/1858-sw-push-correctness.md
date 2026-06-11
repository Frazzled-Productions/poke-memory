---
kind: fixed
issue: 1858
---
- Service worker no longer caches authenticated `/api/**` responses: the GDPR export CSV can no longer persist in Cache Storage after sign-out or be served to a different account.
- SKIP_WAITING multi-tab gate now uses `REQUEST_SKIP_WAITING` so Serwist's unconditional built-in listener cannot bypass it, and queries `includeUncontrolled:true` so the client count is accurate for a waiting worker.
- Push toggle now reconciles against the server on mount: an orphaned subscription (server row deleted after a 410) is re-inserted automatically or the toggle is flipped off so the user knows reminders have stopped.
