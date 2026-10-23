## Why

Starting work from a Poké Memory issue on Orca's Tasks page should make a worktree and run `/start`
on that issue in it. Poké Memory has no `orca.yaml`, so Orca opens its built-in
prompt instead. The ops `orca-shell` requirement "Repo config in a checked-in orca.yaml" (ops change
`orca-yaml-in-app-repos`, ops#79) says ops, koinori, roast-conductor, loop-year and poke-memory each
carry the same file. Fraser ruled on 23 October 2026 that each app repo adopts OpenSpec first and then
carries the file in its own `add-orca-yaml` change; Poké Memory adopted in `adopt-openspec` (#2167).

## What Changes

- A root `orca.yaml` (one tab, one pane: Fraser, 23 October 2026, after the ops#36 task 6.6 live
  check), exactly:
  ```yaml
  defaultTabs:
    - title: Agent
      command: claude "/start"
  ```
  No `issueCommand` (in Orca 1.4.237 it is both the composer agent's prompt and a command run in a
  split of the first tab, which gave two panes in the live check), no other tab, no `scripts` block.
  "Start workspace from issue", with "Blank Terminal" as the composer's agent and setup on, opens one
  tab running `claude "/start"`; `/start` finds the issue Orca linked to the worktree and makes it
  option 1 (ops `session-status`, ops#79). With an agent selected instead, Orca runs its own agent in
  that tab; one session either way.
- Orca reads `orca.yaml` from the primary checkout, which is on `main`, so the file takes effect
  after the next qa-to-main promotion (`git-sync.sh` fast-forwards the checkout within 15 minutes).

The requirement lives in ops (`orca-shell`), and the app's behaviour does not change, so this change
sets `skip_specs: true` and has no `specs/` folder.

## Also touches

- **Review and quiz screens, Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because no app code changes.
- **Guest mode, cloud sync and Supabase migrations:** no change, because no `lib/`, `app/api/` or `db/` file changes.
- **Superuser mode and QA-seed scenarios:** no change, because no app code changes.
- **Locales and pseudo-locale:** no change, because no catalogue changes.
- **Push notifications and the service worker:** no change, because no app code changes.
- **Sign-in, privacy notice and sub-processors:** no change; `orca.yaml` is read only by Orca on Fraser's Mac.
- **Accessibility:** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because nothing user-facing changes; the file reaches `main` with the next promotion.
- **CI and GitHub Actions:** no workflow change. A root `orca.yaml` is not docs, so this PR runs the full `test` job and coverage once (e2e skips, as no e2e-relevant path changes).
- **Vercel deployments:** no change; Next.js ignores a root YAML file.

## Removes

Nothing, because Poké Memory has no Orca config today.

## Out of scope

- A setup script, `.worktreeinclude` or any `scripts` block.
- The `/start` skill's handling of an issue URL (ops `session-status`, ops#79 section 2).
- Promoting `qa` to `main` (Fraser's gate).

## Owner decisions relied on

- 23 October 2026: Orca as the shell, a checked-in `orca.yaml` per repo, `issueCommand` running `/start` with the issue (ops#32).
- 23 October 2026: no setup script; only `issueCommand` and the default tabs (ops#46).
- 23 October 2026, after ops#36 task 6.6: one tab, one pane; one "Agent" tab running `claude "/start"`, no `issueCommand` (ops#79).
- 23 October 2026, on ops#79: adopt OpenSpec first, then a new `add-orca-yaml` change into `qa` for Poké Memory; run ops#36's live check (task 6.6) before any `orca.yaml` PR merges.

## Clarifications

- 2026-10-23 Q: Setup script in `orca.yaml`? A: No; only `issueCommand` and the default tabs (Fraser).
- 2026-10-23 Q: Poké Memory gets an `orca.yaml`? A: Yes (Fraser, ops#79).
- 2026-10-23 Q: Merge before ops#36 task 6.6 proves `{{artifact_url}}` live? A: No; leave this PR green and unmerged until it passes (Fraser).
- 2026-10-23 Q: Did the live check (ops#36 task 6.6) pass? A: Partly: the issue command ran, but as a split beside Orca's agent pane, plus a Ledger tab (Fraser).
- 2026-10-23 Q: Keep that layout? A: No: one tab, one pane. `orca.yaml` is one "Agent" tab running `claude "/start"`, no `issueCommand`; `/start` finds the worktree's linked issue (Fraser, ops#79). Merge only after ops#79 task 1.3, the live recheck, passes.
