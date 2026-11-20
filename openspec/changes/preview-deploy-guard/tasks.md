## 1. Build

- [x] 1.1 Guard tests first: extend `scripts/workflows-no-backups.test.mjs` ("preview guard", the reworked "deploy guard" preview test and the preview token holder test). Verify: red on the old workflows, 6 failed and 10 passed, each for the predicted reason (the `preview` job names `Preview` and Cloudflare secrets, `deploy.yml` uploads, `preview-upload.yml` missing).
- [x] 1.2 `deploy.yml`: the `preview` job builds, bundles and uploads the `preview-bundle` artefact with no environment and no secret; `preview-e2e` leaves; header rewritten. Verify: the tests in 1.1 green (`npx vitest run --project node scripts/workflows-no-backups.test.mjs scripts/lib/playwright-pin.test.mjs`, 26 passed, exit 0) and `actionlint` exit 0.
- [x] 1.3 New `preview-upload.yml` (`workflow_run` of Deploy, `Preview`, base branch checkout, artefact checks, migrations, seed, `--no-bundle` upload, comment, auth specs). Verify: same run as 1.2, `npm run lint:playwright-pin` OK; after the workflow review, the artefact checks use `find -print -quit` (a `find | grep -q` check passed 3000 symlinks under pipefail; the new one printed REFUSED on the same set) and the concurrency group includes the head repository.
- [x] 1.4 Prove the bundle equals what the old upload sent (design D2). Verify: local `cf:build`, then `wrangler versions upload --dry-run` both ways: "Total Upload: 21082.38 KiB" both, same bindings, and `cmp` reports `index.js`, both `.wasm` files and the `.bin` font identical.
- [x] 1.5 Drop the `cf:upload-preview` npm script. Verify: `git grep cf:upload-preview` finds only the guard test's pattern.
- [x] 1.6 Docs: `WORKFLOW.md` (Deploy and a new Preview upload section), `AGENTS.md`, `docs/persistence.md`, `docs/testing.md`, `.claude/agents/{workflow-expert,playwright,data-coder,d1-expert}.md`, `.claude/commands/batch-issues.md`. Verify: `npm run lint` exit 0.
- [x] 1.7 `OPENSPEC_TELEMETRY=0 openspec validate preview-deploy-guard --strict`. Verify: "is valid".

## 2. After merge

- [x] 2.1 ~~Set the `Preview` environment's deployment branches to `main` only once this is on `qa`, and quote the environment JSON.~~ Moved to #2411
- [x] 2.2 ~~Fraser promotes `qa` to `main`; `preview-upload.yml` becomes active.~~ Moved to #2411
- [x] 2.3 ~~Fraser creates `CLOUDFLARE_PREVIEW_API_TOKEN` in `Preview` once all five repos have the guard on `main`, then the first preview upload is checked end to end.~~ Moved to #2411
