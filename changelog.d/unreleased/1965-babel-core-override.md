---
kind: security
issue: 1965
---
- Pinned `@babel/core` to `>=7.29.6` via npm `overrides` to clear Dependabot alert #13 (arbitrary file read via `sourceMappingURL` comment); it arrives transitively through `@sentry/nextjs`'s build-time bundler plugin and `eslint-config-next`, so it could not be bumped directly.
