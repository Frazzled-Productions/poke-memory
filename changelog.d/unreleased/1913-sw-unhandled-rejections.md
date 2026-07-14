---
kind: fixed
issue: 1913
---
- Service-worker registration and update failures no longer surface as unhandled promise rejections. A browser that declines to register a service worker (private browsing, enterprise policy, a search-engine crawler) now degrades silently to an online-only page instead of reporting an error.
