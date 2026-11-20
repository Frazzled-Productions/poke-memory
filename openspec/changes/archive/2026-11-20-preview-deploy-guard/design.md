## Context

Shared design for koinori #2925 F3 and F4 across five repos. Poké Memory differs from the plain
OpenNext sites in three ways: its Worker entry is `worker/index.ts` wrapping `.open-next/worker.js`,
its preview job also migrates and seeds a preview D1 database, and Playwright auth specs run against
the preview.

## Decisions

### D1. Build in the PR without a token, upload from `workflow_run`

`deploy.yml`'s `preview` job has no environment and no secret. `preview-upload.yml` runs from the
default branch, so a PR can neither edit it nor reach `Preview`, whose deployment branches become
`main` only (#2411). Its `if:` requires a successful same-repo `pull_request` run whose PR targets
`qa` or `main`.

### D2. Upload a pre-bundled Worker with `--no-bundle`

`opennextjs-cloudflare upload` (1.20.17) imports `.open-next/.build/open-next.config.edge.mjs`, so it
would run artefact code next to the token: not used. Letting the trusted wrangler bundle
`worker/index.ts` would mix base and PR code, and esbuild would resolve whatever paths the untrusted
`.open-next/worker.js` imports. Instead the PR job copies `.open-next/cache` into
`.open-next/assets/cdn-cgi/_next_cache` (what OpenNext's populateCache does for the static-assets
cache) and runs `wrangler deploy --dry-run --env preview --outdir`; the trusted job uploads that with
`wrangler versions upload --config wrangler.jsonc --env preview --no-bundle <bundle>/index.js`.
`--config` is required: with a script path wrangler otherwise looks for a config next to the script,
inside the artefact. Proved locally on a real `cf:build`: both dry runs reported "Total Upload:
21082.38 KiB", the same six bindings and the same three extra modules, and `index.js`, both `.wasm`
files and the `.bin` font were byte-identical (`cmp`) to what `wrangler versions upload` bundles from
`worker/index.ts`.

### D3. The PR's migrations, the base branch's bindings

The artefact carries `db/d1/migrations`; the trusted job refuses any non-`.sql` file and applies them
with the base branch's `wrangler.jsonc`, so they reach only the preview database. Applying the base
branch's migrations instead would break the preview of every PR that adds one.

### D4. Auth specs from the base branch

`preview-e2e` moves to `preview-upload.yml` and checks out the base branch, so no PR code runs in the
default-branch context (its caches are shared with `main`). The PR's own copy still runs in `ci.yml`.

### D5. Order

The branch rule on `Preview` is set only after this change is on `qa`: every PR into `qa` then runs the
new `deploy.yml`. A hotfix PR straight into `main` would still run `main`'s old `preview` job, which
the rule then refuses; that job is not a required check on `main`.

## Risks

- `preview-upload.yml` is inactive until the next promotion: no previews until then.
- Self-hosted runners: none in this repo's deploy or preview jobs.
