---
kind: added
---
- Added `app/global-error.tsx`: a root-layout error boundary that reports uncaught errors to Sentry. `app/error.tsx` does not catch errors thrown in the root layout or template; this boundary fills that gap (follow-up #1822).
