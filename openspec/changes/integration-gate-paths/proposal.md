## Why

The integration gate reports a pass when it skips the suite, so a PR that changes code the suite
exercises can look covered without the suite running. Its path filter misses five paths the suite
reaches, and nothing runs the suite after a PR lands on `qa`. Seen on real PRs: #2139, #2113 and #2163
all changed `app/api/push/**` with `integration` skipped and `integration-gate` passing. Root cause
proven on 2 November 2026 (see `design.md`). This is finding 13 of
`ops/research/turbo-app-audit-2026-11-01.md`.

Fixes: poke-memory #2220

## What Changes

- `.github/workflows/integration-tests.yml`: add `lib/storage/**`, `lib/idb/**`, `lib/settings/**`,
  `lib/auth/**` and `app/api/push/**` to the `cloud_write` filter. The audit named four;
  `lib/settings/**` is a fifth, found by listing what the suite imports (open call, see Clarifications).
- Same file: add a `push` trigger on `qa`, with the same sprite `paths-ignore`. `Decide` sets
  `run=true` on a push, as it does on a manual dispatch, so every code merge runs the suite.
- New `scripts/integration-gate-paths.test.mjs` (runs in the required `test` job): fails, naming the
  path, when `lib/sync/integration/` imports a first-party path the filter misses. It also runs the
  workflow's real `Decide` script for each trigger.
- `WORKFLOW.md` and `docs/testing.md` say the same thing. They already missed the divergence script.

## Also touches

Filled with the `blast-radius` skill on 2 November 2026. Evidence for each line is in `design.md`.

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because nothing under `components/` changes and `app/` is only named in a filter.
- **Guest mode (localStorage):** no change, because no app code changes.
- **Cloud sync and Supabase migrations (both projects):** no change to either. The suite that checks them runs more often.
- **Superuser mode and QA-seed scenarios:** no change, because no app code or seed script changes.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy changes.
- **Push notifications and the service worker (offline):** no change to either. A PR touching `app/api/push/**` now runs the suite.
- **Sign-in:** no change to the code. A PR touching `lib/auth/**` now runs the suite.
- **Privacy notice and sub-processors:** no change, because no data flow changes.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because `changelog-gate.yml` asks for one only when `app/**`, `components/**` or `lib/**` change, and this PR changes none of them. The release itself is unaffected: a push to `main` does not trigger this workflow, and `integration-gate` is not a required check on `main`.
- **CI and GitHub Actions:** the behaviour change in this PR. More PRs run a required check (4 of the last 100 merged to `qa` would newly have matched: #2163, #2139, #2113, #1953), and each code merge to `qa` adds about 2 minutes of hosted time, free on this public repo (`ops` #284 records the same). No `uses:` line changes, so this does not collide with #2159 (pinning actions). It needs a `workflow-expert` review (see tasks).

## Removes

Nothing, because the suite, the label and the manual dispatch all stay: the label still covers a PR
outside the filter that needs the suite before merge, which a push run cannot do.

## Out of scope

- Adding every transitive import to the filter: it reaches `lib/srs`, `lib/review`, `lib/pokemon`,
  `lib/stats` and more, close to all of `lib/`. The push run is the backstop (open call, see Clarifications).
- Alerting on a red push run (open call, see Clarifications).
- Pinning actions (#2159) and the wrong required-check list in the docs (#2157).
- Changing the `decide` job's Dependabot guard on PRs.

## Owner decisions relied on

- OpenSpec for every change in every repo except local-ai-trial, bug fixes included (21 October 2026).
- Work lands on `qa`; `main` only takes promotions (`openspec/config.yaml`).
- Anything that costs money is Fraser's call (standing rule). This costs nothing: hosted minutes are free on a public repo.

None of the calls below has an owner decision yet.

## Clarifications

Nobody has answered these. This was built unattended, so each takes the recommended answer as a
default until Fraser rules.

- 2026-11-02, open: add `lib/settings/**`, which the audit did not name? Recommended: yes. `favourite-settings.test.ts` and `settings-clobber.test.ts` import it directly, so leaving it out keeps the same gap.
- 2026-11-02, open: `push` to `qa` or a schedule? Recommended: `push`. `perf-budget.yml` already does this, every merge gets a result, and a schedule would batch them and need `cron-health-monitor` wiring.
- 2026-11-02, open: should the push run use a path filter? Recommended: no, sprites only. The point is to catch what a PR skipped, including Dependabot bumps, which change `package-lock.json`. The cost is about 2 free minutes on a docs-only merge.
- 2026-11-02, open: stop at direct imports in the filter? Recommended: yes. The transitive closure is 72 files across 18 directories, so the filter would match far more PRs. The push run catches those after merge.
- 2026-11-02, open: who hears about a red push run? Recommended: nothing new for now. Today it is a red mark on the `qa` commit and GitHub's own failure email to the person who merged. If that gets missed, add a marker-issue monitor as a separate change.
