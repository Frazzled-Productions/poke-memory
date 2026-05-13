---
kind: fixed
---
- Settings → About now reflects the latest released version after a release lands. The Vercel ignored-build-step was skipping `chore(release):` commits, but `next.config.ts` bakes `pkg.version` into the bundle, so production was always one release behind.
