---
kind: fixed
---
- Hotfix PRs merged directly to `main` now automatically backmerge into `qa` so the next promotion PR is never silently behind. Previously a hotfix could block auto-merge until a manual sync PR was raised.
