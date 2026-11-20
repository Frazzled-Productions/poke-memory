## Context

`preview-upload.yml` is a `workflow_run` workflow: GitHub always runs the default branch's copy of the
file, and its `Preview` environment admits only `main`. That makes the workflow file trusted, but not
what it checks out. It checks out the PR's base branch and runs that tree's config, dependencies, seed
and specs with `CLOUDFLARE_PREVIEW_API_TOKEN` in the environment of the wrangler steps.

## Root cause

**Current behaviour.** For a same-repository PR into `qa` whose Deploy run succeeds, the `upload` job
checks out `qa` (`preview-upload.yml:73-77`, `ref: ${{ github.event.workflow_run.pull_requests[0].base.ref }}`),
runs `npm ci` from `qa`'s lockfile (line 99, lifecycle scripts run), `node scripts/cloudflare/seed-preview.mjs`
from `qa` (line 142), and `npx wrangler ... --config wrangler.jsonc` from `qa`'s `node_modules` and
config with the token set (lines 133, 145, 157). `preview-e2e` checks out `qa` again (line 214) and runs
`npm ci` and `qa`'s auth specs. A change merged into `qa` with green CI can therefore run code next to
the token or repoint `env.preview` at production resources for every later `qa` preview.

**Expected behaviour.** Everything that runs or configures a run comes from `main`, which only changes
through a promotion Fraser owns; the PR contributes only bytes that are uploaded or applied to the
preview database.

**Unchanged behaviour** (each becomes a regression check):
- WHEN `Preview` holds no `CLOUDFLARE_PREVIEW_API_TOKEN` THEN the upload SHALL CONTINUE TO skip with a
  notice and a green run.
- WHEN a PR's artefact holds a symlink, a non-file or a non-`.sql` migration THEN the upload SHALL
  CONTINUE TO refuse it.
- WHEN a PR adds a `.sql` migration THEN its preview SHALL CONTINUE TO have it applied to the preview
  database.
- WHEN the PR is the `qa` to `main` promotion or a Dependabot PR into `main` THEN its preview SHALL
  CONTINUE TO use `main`'s files, as today.
- WHEN a pull_request job names `Preview` or a Cloudflare secret THEN the guard test SHALL CONTINUE TO
  fail.

**Evidence.**
- Cited: `preview-upload.yml:46` admits base `qa` or `main`; lines 76 and 214 check out the base ref.
- Cited: `gh api repos/Frazzled-Productions/poke-memory/rulesets/16499371` (20 November 2026):
  `qa-staging` has one rule, `required_status_checks` (strict off), and no pull-request rule.
- Cited: `main-protection` is also only required status checks (strict, including `Restrict main PR
  source`); `main`'s extra trust is that it takes only PRs from `qa` or with the `hotfix` label, and
  promotions are Fraser's.
- Seen: run 44806717982 (20 November 2026) passed with the notice "No CLOUDFLARE_PREVIEW_API_TOKEN
  secret in the Preview environment" and skipped every later step, so nothing has run with a token.
- Seen: a check that every `ref:` in the workflow is `main` fails on `origin/main`'s file ("76: ref:
  ${{ ...base.ref }}", "214: ...", "FAIL: 2 checkout(s) not pinned to main", exit 1) and passes on the
  same file with both refs set to `main` (exit 0). The existing guard test passes today (16 passed)
  because it asserts the base ref (`scripts/workflows-no-backups.test.mjs`, "checks out only the pull
  request's base branch").
- Unknown: the payload's `pull_requests[0].base.ref` for a `qa` PR could not be read back, because the
  REST API recomputes that list from open PRs and every recent `qa` PR is merged; the `if:` at line 46
  shows `qa` is an intended value.

**Hypotheses ruled out.** "`qa` is protected like `main`": no, rulesets above. "The workflow_run
context already pins the default branch": only for the workflow file; an explicit `ref:` overrides the
checkout. "Exposure has happened": no token has ever existed. "The other Cloudflare repos share it":
website, koinori-web and plan-bee admit only base `main` (`preview-upload.yml:39-42` in each); koinori's
tutor proxy has the same fault (koinori #2936).

**First wrong step.** `preview-upload.yml:76` (and 214): choosing the PR's base ref as the trusted tree,
from the premise that the work base is protected (`preview-deploy-guard` D1, D4).

**Failing test that lands first.** The guard test's checkout assertion changed to require `ref: main`
for every checkout; red on today's file for that reason, then green.

**Always-on signal.** The notice and PR comment line naming trusted files that differ from `main`
(decision 1), so a preview built against `main`'s config is never a surprise.

## Decisions

### D1. Check out `main`, by name

Both checkouts use `ref: main`. A literal is readable and the guard test can match it exactly.
`github.sha` (the default branch commit the run started on) would pin both jobs to one commit, but `main`
moving between the two jobs only changes which trusted commit the specs come from, so it is not worth
the less obvious expression.

### D2. The artefact stays data

Unchanged from `preview-deploy-guard`: the Worker bundle is uploaded with `--no-bundle`, the assets are
served as files, and the PR's `.sql` migrations replace `main`'s `db/d1/migrations` before
`wrangler d1 migrations apply --env preview`. They reach only the preview database, which the PR's own
preview code can reach anyway.

### D3. A `qa` PR that needs config not yet on `main`

Its bundle was built by `deploy.yml` with the PR's own `wrangler.jsonc`, but it is uploaded with
`main`'s bindings, vars and compatibility settings. Consequences until the next promotion:
- a new binding or var in `env.preview` is missing, so code that uses it fails at request time on the
  preview (the upload itself succeeds);
- `main`'s seed runs against a schema that includes the PR's migrations. Additive migrations are fine;
  one that renames or drops a column the seed writes makes the seed load fail, the run goes red and
  nothing is uploaded;
- `main`'s auth specs may not match a PR that changes sign-in; `preview-e2e` is not a required check
  and the PR's own specs run in `ci.yml`.

Recommended handling (decision 1): before the migrations, list the files the PR head changes against
`main` with `gh api repos/{repo}/compare/main...{head_sha}` (paginated, `github.token`, read only, no
checkout of PR code), filter to `wrangler.jsonc`, `package.json`, `package-lock.json`, `.nvmrc`,
`scripts/cloudflare/`, `e2e/` and `playwright.config.ts`, print a notice, and add one line to the PR
comment. The three-dot compare includes changes already on `qa` but not `main`, which is exactly the
set that the preview does not get.

### D4. No `--ignore-scripts`

With the lockfile from `main`, install scripts are as trusted as the production deploy's `npm ci`;
adding `--ignore-scripts` would be a second change with its own risk (native binaries such as
`workerd`), so it is left out.

## Risks

- Inactive until the next promotion carries this file to `main`, like every `workflow_run` change; the
  token must not be created before then (ops #612).
- The compare call can list up to 300 files per page; paginating covers large promotions, and it is a
  notice only, so a failure to list prints a warning and does not block the upload.
