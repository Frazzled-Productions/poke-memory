## Why

`openspec-archive.yml` and `openspec-overlap.yml` both pass `install-openspec: true` to the shared
workflows in `Frazzled-Productions/.github` at `@v1`. Since ops #363 that input does nothing: every
shared job installs one pinned OpenSpec binary, and the input stays declared only because GitHub
fails a call that passes an undefined input. These are the last two real callers, so the shared input
cannot be removed until they stop passing it (ops #369).

This is step 1 of 3 in ops #369, the part with no owner step: the callers change first because
removing a no-op argument is safe while the shared input still exists.

Fixes: none. ops #369 stays open for steps 2 and 3.

## What Changes

- Delete the `install-openspec: true` line from `.github/workflows/openspec-archive.yml` and
  `.github/workflows/openspec-overlap.yml`. Nothing else in either file changes.
- No spec delta: `skip_specs: true`. The house rule in `openspec/config.yaml` says a tooling change
  whose behaviour stays the same has no `specs/` folder. At `v1` nothing reads the input, so both
  workflows run the same steps with or without it. This repo has no spec for the OpenSpec tooling
  (AGENTS.md points to Roast Conductor's `openspec-tooling`), so spec on touch does not apply.

## Also touches

Evidence from the `blast-radius` run on 2 November 2026 against `origin/qa` at `d2456f44` and the
`.github` tag `v1` at `b54555a3`.

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because only two workflow files change; no app code, copy or route is touched.
- **Guest mode (localStorage):** no change, because no app code changes.
- **Cloud sync and Supabase migrations (both projects):** no change, because no schema, client or migration is touched.
- **Superuser mode and QA-seed scenarios:** no change, because neither reads the workflow files.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy changes.
- **Push notifications and the service worker (offline):** no change, because no app code changes.
- **Sign-in:** no change, because no app code changes.
- **Privacy notice and sub-processors:** no change, because no data flow is added or removed.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because `changelog-gate.yml` asks for one only when `app/**`, `components/**` or `lib/**` change, and this is internal tooling.
- **CI and GitHub Actions:** the two callers change; the jobs they run do not. With the line gone both callers still pass every required input and no undefined one, checked against the `v1` workflow files. At `v1` the input is declared with `default: false` and read nowhere in either workflow, and the "Install the pinned openspec CLI" step has no condition. `git grep` finds no other file on `qa` that depends on these lines, and no open PR touches either file. The `pull_request` overlap check on the build PR runs the new caller. The archive caller's first real run is the push to `qa` that merging this change triggers. Until step 2 of ops #369, the scheduled and manual archive runs use `main`'s caller (GitHub runs both from the default branch), which still passes the no-op, so they behave as they do today.

## Out of scope

- Step 2 of ops #369: promoting `qa` to `main`. That is Fraser's.
- Step 3 of ops #369: removing the input from the shared `.github` workflows, with the self-test line, the shape test, the README and the ops `shared-ci-workflows` requirement "Callers that pass install-openspec keep working". That needs its own proposal, approved by Fraser, and must follow step 2.
- The other branches that still carry the line. A branch picks this up when `qa` is merged into it.

## Owner decisions this relies on

- 21 October 2026: every change goes through OpenSpec (`openspec/config.yaml`).
- 23 October 2026: the OpenSpec tooling is shared, and each workflow here is a short caller of a reusable workflow in `Frazzled-Productions/.github` at `@v1` (AGENTS.md, "OpenSpec").

## Removes

- `install-openspec: true` from `.github/workflows/openspec-archive.yml` (1 line).
- `install-openspec: true` from `.github/workflows/openspec-overlap.yml` (1 line).

## Clarifications

Open calls for Fraser's review on 2 November 2026 (overnight spend run, ops #383), each with a
recommended answer. None has an answer yet.

- 2026-11-02 Q: Does a two-line CI tidy-up need this OpenSpec change, or the `no-spec` label instead? Recommended: this change, because "OpenSpec required" fails a non-docs PR into `qa` without one, and the `no-spec` label is Fraser's alone to add. A: open.
- 2026-11-02 Q: ops #369 said 11 branches still carry the line, but a count on 2 November finds 24 besides `qa` and `main`, mostly new spike branches. Must every one have `qa` merged in before step 3? Recommended: no. Before step 3, recount and merge `qa` only into branches still in use, and test the shared removal against one of them first. GitHub normally runs a `pull_request` workflow from the PR's merge commit, which would already drop the line, but this was not tested here. A: open.
