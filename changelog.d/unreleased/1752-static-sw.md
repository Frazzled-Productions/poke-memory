---
kind: fixed
issue: 1752
---
- The PWA service worker is now served as a true static asset (`public/sw/sw.js`) generated at build time, rather than by a request-time serverless function. This removes the class of bug behind the earlier production 500 (#1749) for good, instead of patching it: a Next.js upgrade can no longer reintroduce a missing-module failure, and the worker is served straight from the CDN. The registration URL is unchanged, so installed PWAs keep working without re-registering.
