## 1. Build

- [ ] 1.1 Guard test first: in `scripts/workflows-no-backups.test.mjs` ("preview guard"), change "checks out only the pull request's base branch" to require `ref: main` for every checkout in `preview-upload.yml` and no `base.ref` or `head` ref. Verify: `npx vitest run --project node scripts/workflows-no-backups.test.mjs` red on today's workflow, exactly that test failing because lines 76 and 214 use the base ref.
- [ ] 1.2 `preview-upload.yml`: both checkouts `ref: main`; the readiness step and its notices name `main`'s `wrangler.jsonc`; header comment rewritten (trusted files from `main`, bundle and `.sql` migrations from the artefact). Verify: the test in 1.1 green, `actionlint` exit 0, `npm run lint:playwright-pin` OK.
- [ ] 1.3 Per decision 1 (recommended option): a step before the migrations lists trusted files the PR head changes against `main` (`gh api --paginate repos/$GITHUB_REPOSITORY/compare/main...$HEAD_SHA`, filtered to `wrangler.jsonc`, `package.json`, `package-lock.json`, `.nvmrc`, `scripts/cloudflare/`, `e2e/`, `playwright.config.ts`), prints a notice and adds one line to the PR comment; a listing failure is a warning, never a block. Verify: run the same `gh api` and filter locally against a real `qa` commit ahead of `main` and quote the listed files; a guard test, written first and red before the step exists, asserts the step checks out nothing and uses `github.token`.
- [ ] 1.4 `deploy.yml` comments (lines 18-20 and 150-151) say `main`'s config, not the base branch's. Verify: `git grep -n "BASE branch\|base branch's wrangler" .github/workflows` finds nothing.
- [ ] 1.5 Docs: `WORKFLOW.md` (Preview upload: What it does, Skips), `.claude/agents/workflow-expert.md` (previews bullet), `.claude/agents/playwright.md` (spec source). Verify: `npm run lint` exit 0 and `git grep -n "base branch" WORKFLOW.md .claude/agents` shows no preview line claiming base-branch config.
- [ ] 1.6 Reviews: `workflow-expert` review of the workflow diff (AGENTS.md: every workflow change), then `/opsx:verify preview-upload-trust-main`, `blast-radius` and `final-review`. Verify: findings fixed or listed in the PR body.
- [ ] 1.7 `OPENSPEC_TELEMETRY=0 openspec validate preview-upload-trust-main --strict` and the overlap check with its simulated archive. Verify: "is valid", and the "OpenSpec overlap" PR check green.

## 2. After merge

- [ ] 2.1 Fraser promotes `qa` to `main`; only then does the fixed workflow run. Verify: `git show origin/main:.github/workflows/preview-upload.yml | grep -c "ref: main"` prints 2.
- [ ] 2.2 Tell ops #612 the guard is fixed here, so the token can be created once koinori #2936 lands too. Verify: link to the ops #612 comment.
