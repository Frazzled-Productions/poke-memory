## Context

`preview-upload.yml` is a `workflow_run` workflow: GitHub always runs the default branch's copy of the
file, and its `Preview` environment admits only `main`. That makes the workflow file trusted, but not
what it checks out. It checks out the PR's base branch and runs that tree's config, dependencies, seed
and specs with `CLOUDFLARE_PREVIEW_API_TOKEN` in the environment of the wrangler steps. It also writes
the preview D1 database (the PR's migrations and the seed), so its token would need D1 permissions.

## Root cause

**Current behaviour.** For a same-repository PR into `qa` whose Deploy run succeeds, the `upload` job
checks out `qa` (`preview-upload.yml:73-77`, `ref: ${{ github.event.workflow_run.pull_requests[0].base.ref }}`),
runs `npm ci` from `qa`'s lockfile (line 99, lifecycle scripts run), `node scripts/cloudflare/seed-preview.mjs`
from `qa` (line 142), and `npx wrangler ... --config wrangler.jsonc` from `qa`'s `node_modules` and
config with the token set (lines 133, 145, 157). `preview-e2e` checks out `qa` again (line 214) and runs
`npm ci` and `qa`'s auth specs. A change merged into `qa` with green CI can therefore run code next to
the token or repoint `env.preview` at production resources for every later `qa` preview.

**Expected behaviour.** Everything that runs or configures a run comes from `main`, which only changes
through a promotion Fraser owns; the PR contributes only bytes that are uploaded (the Worker bundle and
static assets). The preview token needs Workers permissions only, and the preview database is written
only by `main`'s deploy.

**Unchanged behaviour** (each becomes a regression check):
- WHEN `Preview` holds no `CLOUDFLARE_PREVIEW_API_TOKEN` THEN the upload SHALL CONTINUE TO skip with a
  notice and a green run.
- WHEN a PR's artefact holds a symlink or a non-file THEN the upload SHALL CONTINUE TO refuse it.
- WHEN the PR is the `qa` to `main` promotion or a Dependabot PR into `main` THEN its preview SHALL
  CONTINUE TO be uploaded with `main`'s files, as today.
- WHEN a pull_request job names `Preview` or a Cloudflare secret THEN the guard test SHALL CONTINUE TO
  fail.
- WHEN `main` is deployed THEN production migrations and the production Worker SHALL CONTINUE TO be
  applied and deployed exactly as today, before any preview-database step.

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
- Seen (20 November 2026, `gh secret list --env Production|Preview` and repo level): `Production` holds
  `CLOUDFLARE_API_TOKEN` and `SENTRY_AUTH_TOKEN`; `Preview` holds nothing; no `PREVIEW_TEST_PASSWORD`
  exists anywhere, so the seed's test users get a random password today and after this change.
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
for every checkout, plus "no `wrangler d1` or seed in `preview-upload.yml`" and "the production job
migrates and seeds the preview database"; each red on today's files for that reason, then green.

**Always-on signal.** The notice and PR comment lines naming trusted files that differ from `main` and
migrations not yet on `main`, so a preview built against `main`'s config and schema is never a surprise.

## Decisions

### D1. Check out `main`, by name

Both checkouts use `ref: main`. A literal is readable and the guard test can match it exactly.
`github.sha` (the default branch commit the run started on) would pin both jobs to one commit, but `main`
moving between the two jobs only changes which trusted commit the specs come from, so it is not worth
the less obvious expression.

### D2. The artefact is the bundle and the assets, nothing else

The Worker bundle is uploaded with `--no-bundle` and the assets are served as files, with the existing
refusals (symlinks, anything but files and directories). `deploy.yml`'s `preview` job no longer copies
`db/d1/migrations` into the artefact, and `preview-upload.yml` no longer reads one: its migrations
refusal, move and apply step go. A PR that edits `deploy.yml` to put a `migrations` folder back gets it
ignored, because nothing reads it.

### D3. The preview database follows `main`, from the trusted deploy

`deploy.yml`'s production job (environment `Production`, `main` only, `CLOUDFLARE_API_TOKEN` already
there for production migrations) gains three steps after "Deploy the Worker", under the same `ok` guard:
1. "Apply D1 migrations (preview database)": `npx wrangler d1 migrations apply DB --remote --env preview`
   (`main`'s `db/d1/migrations`, through `env.preview`'s `migrations_dir`).
2. "Seed the preview database": `node scripts/cloudflare/seed-preview.mjs --out "$RUNNER_TEMP/seed-preview.sql"`
   with `SEED_TEST_PASSWORD: ${{ secrets.PREVIEW_TEST_PASSWORD }}` (no token on this step; the secret
   does not exist yet, so the test users keep a random password, as the seed script documents).
3. "Load the seed into the preview database": `npx wrangler d1 execute DB --remote --env preview --yes
   --file "$RUNNER_TEMP/seed-preview.sql"`.

After the production deploy, not before: a preview-database failure (for example a seed that no longer
matches the schema) can never hold back production; it turns the run red once production is live,
which is visible and fixed by the next push. Koinori's tutor proxy runs its preview migrations before
its deploy; poke-memory's seed is an extra step that can fail, hence the order. The account's only
account-owned API token, `github-actions-deploy` (issued 19 November 2026, 20:10 UTC), grants "D1
Write", "Workers R2 Storage Write" and "Workers Scripts Write" on the whole account (read through the
Cloudflare API on 20 November 2026, names and policies only), so it already covers
`poke-memory-preview`. That this is the token in `Production` is inferred from the dates; the first
deploy of `main` after promotion proves it (task 2.1).

The seed now runs once per deploy of `main` instead of once per preview upload, so the two test users
are reset less often. The guard test's token holders do not change: the production token stays in
`deploy.yml` only, the preview token in `preview-upload.yml` only.

### D4. A PR that differs from `main` (decision 1, and the new-migration notice)

Its bundle was built by `deploy.yml` with the PR's own `wrangler.jsonc`, but it is uploaded with
`main`'s bindings, vars and compatibility settings, against the preview database at `main`'s schema.
Consequences until the next promotion:
- a new binding or var in `env.preview` is missing, so code that uses it fails at request time on the
  preview (the upload itself succeeds);
- a new migration is not applied, so code that needs it fails at request time on the preview;
- `main`'s auth specs may not match a PR that changes sign-in; `preview-e2e` is not a required check
  and the PR's own specs run in `ci.yml`.

Handling (Fraser's ruling on decision 1): a step before the upload calls
`gh api "repos/$GITHUB_REPOSITORY/compare/main...$HEAD_SHA?per_page=1"` with `github.token` (read only,
no checkout of PR code; the files list comes on the first page whatever `per_page` is, up to 300 files,
seen 20 November 2026: 118 files on page 1, none on page 2). It keeps file names made only of
`A-Za-z0-9._/@+-` (so a crafted name cannot inject a workflow command or Markdown), and splits them into:
- trusted: `wrangler.jsonc`, `package.json`, `package-lock.json`, `.nvmrc`, `playwright.config.ts`,
  `scripts/cloudflare/*`, `e2e/*`;
- migrations: `db/d1/migrations/*`.

Each non-empty list prints a `::notice::` and adds one line to the PR comment. The three-dot compare
includes changes already on `qa` but not on `main`, which is exactly what the preview does not get. A
failed call prints a `::warning::` and the upload goes ahead; 300 files prints a warning that the list
may be incomplete.

### D5. No `--ignore-scripts`

With the lockfile from `main`, install scripts are as trusted as the production deploy's `npm ci`;
adding `--ignore-scripts` would be a second change with its own risk (native binaries such as
`workerd`), so it is left out.

## What changes for qa.pokememory.com

**Today** (checked 20 November 2026 through the Cloudflare API): `qa.pokememory.com` is the Worker Custom
Domain of `poke-memory-preview`. Its live deployment is version `a483f522`, deployed with wrangler by
hand from the `qa-on-preview-worker` branch at 14:01 UTC (that change's task 2.3); no workflow deploys
it, and `wrangler versions upload --preview-alias pr-<n>` never changes what it serves. Its D1 database
`poke-memory-preview` is shared with every `pr-<n>` version. Its `d1_migrations` table holds `0001` to
`0003` (19 November 2026, 21:03) and `0004` (20 November 2026, 11:16), all applied by hand, and matches
`main` and `qa`. `preview-upload.yml` has never written it (no token).

**After this change:**
- The live deployment is still made by hand from `qa`; nothing here deploys it.
- Every deploy of `main` (a push, or the dispatch after a release) applies `main`'s migrations to its
  database and reloads the two `preview-tester-*` users (their data rows are reset and their sessions
  deleted; no other row is touched). Nobody can sign in as them until `PREVIEW_TEST_PASSWORD` exists.
- No pull request's migration reaches its database any more. Under `preview-deploy-guard`, once the
  token existed, every PR's `.sql` files would have been applied to this shared database, so an unmerged
  PR could have changed `qa.pokememory.com`'s schema; that is gone.
- A migration on `qa` not yet on `main` still has to be applied by hand when `qa` is deployed by hand,
  as today. `wrangler d1 migrations apply` records migrations by file name, so the next deploy of
  `main` skips it once it arrives. If such a migration's file is renamed before it reaches `main`, it
  would be applied a second time under the new name; and a hand-applied migration that drops or
  renames a column `main`'s seed writes would make the seed step fail (after production is live).

## Risks

- Inactive until the next promotion carries both workflows to `main`, like every `workflow_run` change;
  the token must not be created before then (ops #612).
- The production job now writes a second database. Its token already could; the steps target it only
  through `--env preview`, which the guard test's production-data check already requires of every
  `d1 execute --remote`.
- The compare call is a notice only, so a failure to list prints a warning and does not block the
  upload.
