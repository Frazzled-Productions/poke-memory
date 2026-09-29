---
kind: changed
issue: 2076
---
- Removed the Sentry `webpack.treeshake.removeDebugLogging` build option, which did nothing because Next 16 builds with Turbopack, and corrected the `next.config.ts` notes that described the build as webpack-based. A new guard test (`lib/observability/nextConfigSentry.test.ts`) fails if a `webpack` Sentry option returns or the source-map upload hook is switched off. No behaviour change.
