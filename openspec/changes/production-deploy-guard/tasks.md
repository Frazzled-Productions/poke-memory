## 1. Build

- [x] 1.1 `deploy.yml`: production job in `Production`, `main` only, no release trigger, a `workflow_dispatch` trigger; preview job in `Preview` with the new notice. Verify: "deploy guard" tests in `scripts/workflows-no-backups.test.mjs`, red on the old files (all 5 new tests failed for the missing guard), then green (10 passed).
- [x] 1.2 `auto-release.yml`: `actions: write` and a last step that dispatches `deploy.yml` on `main` after a pushed release commit. Verify: "is dispatched on main by auto-release.yml" test, red then green.
- [x] 1.3 `wrangler.jsonc`: top-level `workers_dev: false`, `env.preview` `workers_dev: true`. Verify: "production Worker address" test, red then green.
- [x] 1.4 `next.config.ts`: `silent: !process.env.CI`. Verify: `lib/observability/nextConfigSentry.test.ts` still passes; the deploy log check is 2.2.
- [x] 1.5 Docs: `WORKFLOW.md`, `.claude/commands/batch-issues.md`, `.claude/agents/workflow-expert.md`. Verify: `npm run lint`.

## 2. After merge to main

- [x] 2.1 ~~Confirm a production deploy succeeds from the `Production` environment, then delete the repository-level `CLOUDFLARE_API_TOKEN`, and confirm the production workers.dev address stops serving while pokememory.com answers 200.~~ Moved to #2393
- [x] 2.2 ~~Set `SENTRY_ORG` and `SENTRY_PROJECT` from Fraser's slugs and confirm the next production deploy log shows the source maps uploading.~~ Moved to #2393
