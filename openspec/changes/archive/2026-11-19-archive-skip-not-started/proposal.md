## Why

Poké Memory's OpenSpec archive job assumes every active change on `qa` has been built. Approved proposals merge to `qa` before their build, so the job reaches a change with no task ticked, fails `openspec validate --archived` and lands nothing (seen on `fix-investigate-ci-failure-skill` and `remove-dead-todo-hook`, #2192 and #2195). Koinori hit the same fault for 11 days (koinori #2591) and fixed it with an opt-in input in the shared tools; Fraser ruled that Poké Memory gets the same one-line caller change (koinori #2643, Q3, 6 November 2026). Tracked here as #2376.

## What Changes

- `.github/workflows/openspec-archive.yml` sets `skip-not-started: true` (Frazzled-Productions/.github v1.9.0, which `@v1` now points at). The job then leaves each change with at least one task and none ticked in place and names it in the run log.
- A change with some tasks ticked and some not still fails loudly, as today: a partial build must be ticked or its tasks moved to an issue.
- The caller's header stops saying it archives every change.
- New capability `openspec-tooling`: a baseline of what the shared archive job does (spec on touch), plus the skip and the short titles that came with v1.9.0.

## Also touches

Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new, guest mode, cloud sync and Supabase migrations, superuser mode and QA-seed scenarios, locales, push notifications and the service worker, sign-in, privacy notice and sub-processors, accessibility, README screenshots: no change, because the archive job's diff is refused unless it is plain files under `openspec/`.

- **Changelog fragments and the release:** no change, because nothing user-facing changes.
- **CI and GitHub Actions:** changes. One input in the archive caller; the code is in `Frazzled-Productions/.github`. Runner, permissions and required contexts do not change. The 200-character short titles already reach this repo through `@v1`.

## Removes

"Archives every OpenSpec change" in the caller's header. No code is removed.

## Out of scope

- `harden-push-delivery` on `qa` today is partly ticked (12 of 13), so the next archive run fails on it with or without this input, as intended. It needs ticking or moving in its own PR.
- The OpenSpec overlap check and `archive.py simulate` do not know about the skip (accepted for Koinori as Q7; same here).
- A PR check for ticked tasks (koinori #2836 is the Koinori follow-up).

## Owner decisions relied on

- 22 October 2026: changes are archived after merge, by CI, never by hand.
- 23 October 2026: the OpenSpec tooling is shared and changed in `Frazzled-Productions/.github`.
- 6 November 2026 (koinori #2643, Q2 and Q3): the skip is opt-in, default false; Poké Memory gets a one-line follow-up caller PR.

## Clarifications

- Q3 on koinori #2643, does Poké Memory adopt the skip (6 November 2026): yes, a one-line follow-up caller PR after the shared change lands.
