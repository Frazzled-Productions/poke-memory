## Root cause

Proven on 2 November 2026 (`root-cause` skill, overnight spend wave 3). Labels: Seen, Cited, Inferred.

**Current behaviour.** A PR that changes `app/api/push/send-streak-nudge/route.ts` gets `integration`
skipped and `integration-gate` success, although `push-streak-nudge-rpc.test.ts` pins what that route
reads. After merge, no run happens on `qa`.

**Expected behaviour.** A PR changing a path the suite imports or pins runs the suite, and every code
merge to `qa` runs it.

**Unchanged behaviour.**

- WHEN a PR touches only paths outside the filter and has no label THEN `integration` SHALL CONTINUE TO skip and `integration-gate` to pass.
- WHEN a PR carries the `integration-tests` label THEN the suite SHALL CONTINUE TO run.
- WHEN a run is dispatched by hand THEN the suite SHALL CONTINUE TO run.
- WHEN a PR is from Dependabot THEN `decide` SHALL CONTINUE TO skip and `integration-gate` to pass.
- WHEN a PR or push touches only `public/sprites/**` THEN the workflow SHALL CONTINUE TO not start.

**Tried before.** #611 and #647 added the filter on 15 May 2026, scoped to the "cloud-write surface".
#2104 added the divergence script after a test began importing it. Nothing fails when a test starts
importing from outside the filter, so each addition depended on someone noticing.

**Hypotheses ruled out.**

- "The label covers these PRs": Seen no. #2139, #2113 and #2163 show `integration` skipped.
- "A later run on `qa` catches them": Cited no. Lines 27-32 have no `push` or `schedule` trigger.
- "The promotion PR catches them": Inferred partial only. Its `pull_request` run is filtered over the whole `qa` diff, so it does run for most batches, but after the batch is built and not per merge. It would still skip a batch outside the filter.

**Surviving mechanism.** Seen: `git log` for the filter plus the check runs below.

| PR | Paths outside the old filter | `integration` | `integration-gate` |
|---|---|---|---|
| #2139 | `app/api/push/send-streak-nudge/route.ts` | skipped | success |
| #2113 | same, plus `lib/push/streakNudgePredicate.ts` | skipped | success |
| #2163 | `app/api/push/send-daily`, `send-streak-nudge`, `lib/supabase/**` | skipped | success |

**First wrong step.** `.github/workflows/integration-tests.yml:61-70`: the filter is a hand-kept list
of what the suite covers, read as the "cloud-write surface" and not derived from the suite, and the
gate at `:148` turns any skip into a pass. The missing `push` trigger at `:27-32` left no second chance.

**Same fault elsewhere.** The audit named four paths. Listing the suite's imports found a fifth,
`lib/settings/**` (Seen, red test below). `lib/push/**` and `lib/supabase/**` are not imported by the
suite, so they are not in the filter and rely on the push run. `visual-regression.yml` has the same
hand-kept shape but compares pixels, not imports, so it is not touched here.

**Failing test that lands before the fix.** `scripts/integration-gate-paths.test.mjs`, on `qa` at
`d2456f44`: exit 1, 3 failed, 6 passed. The filter test named the six missing specifiers, the trigger
test found no `push`, and `Decide` printed `run=false` for a push.

**Always-on signal.** The same test, in the required `test` job.

## Baseline (current behaviour, before this change)

Written from `.github/workflows/integration-tests.yml` on `origin/qa` at `d2456f44`: triggers
`pull_request` and `workflow_dispatch`; `decide` skips Dependabot's PRs; a filter match, the label or
a dispatch sets `run=true`; `integration-gate` always reports and passes on a skip; the workflow uses
no secrets. The delta spec records these as baseline requirements and adds the fix.

## Decisions

- **Test, not lint:** the check runs in the existing `test` job, with no new `package.json` script.
- **No new dependency:** the test reads the filter with a regex, because `js-yaml` is only transitive.
- **Direct imports only:** see Clarifications.
- **`Decide` is run, not read:** the test extracts the real script and executes it in `bash`, so the
  baseline scenarios are checked against the workflow as written.
- **`decide`'s `if:` stays:** a push to `qa` is made by the merger. The last 8 `push` runs on `qa` show
  `fraserbrookhouse` or `poke-memory-bot[bot]`, so the Dependabot guard does not stop them.

## Blast radius (2 November 2026)

**The one fact it is safe because of:** on PRs the change only adds matches, and nothing the old
filter matched is lost; on pushes it adds a run that no ruleset requires. Rung 4, ran it: against the
16,475 tracked files, with picomatch 2.3.2 and `dot: true` as a stand-in for the action's matcher,
lost from the old filter 0, gained 38. The test's own matcher disagreed with picomatch on 0 files.

**Risks, confirmed**

- More PRs wait on a required check. 4 of the last 100 merged to `qa` would newly match. Low cost: the suite took about 2 minutes, and the last 100 runs had 0 failures (73 success, 25 cancelled, 2 no conclusion yet).
- A red push run has no owner beyond GitHub's email. Open call.
- Two quick merges cancel the older push run (`concurrency`, `cancel-in-progress`). The newer tip is tested, so a fault is caught at the tip. The cancelled run shows as cancelled on the older commit. Same as `perf-budget.yml`.
- Not proven until after merge: the `push` trigger itself cannot fire from a PR. `actionlint` exits 0 and the `Decide` branch is tested, but the first real run is the check (task 3.3).

**Cleared**

- Required checks: no job is renamed. `integration-gate` keeps its name.
- Fork PRs: still `pull_request`, no secrets, unchanged permissions, event data still passed through `env:`.
- Nothing consumes this workflow by name: `workflow_run` listeners do not name it. `openspec-archive.yml` only lists `integration-gate` as a required context, and `i18n-leak.yml` mentions it in a comment.
- `auto-release.yml` resets `qa` to `main` with an app token, so a reset can start a push run. It is one run with no write access, and `[skip ci]` commits skip it (Inferred from GitHub's documented behaviour, not run).
- `contains(github.event.pull_request.labels.*.name, ...)` on a push: the same expression already runs on `workflow_dispatch` with no PR in the payload.
- #2159 (pinning actions): no `uses:` line changes.
