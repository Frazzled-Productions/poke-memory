## Why

Every Frazzled-Productions repo except local-ai-trial adopts OpenSpec at its next change, enforced by
the shared "OpenSpec required" check (owner decision 23 October 2026). Until Poké Memory adopts it,
any code PR here would fail that check with "Adopt OpenSpec first", and the next planned change
(`add-orca-yaml`, ops#79) cannot be written or archived. Plan: #2167, kit:
`ops/standards/openspec-adoption/README.md`.

## What Changes

- `openspec init` (profile core plus verify): `openspec/` and the generated `/opsx:*` commands and
  `openspec-*` skills in `.claude/`, with the em dashes replaced and a "do not archive by hand" note in
  the archive command and skill.
- `openspec/config.yaml` from the kit, with Poké Memory's "Also touches" surfaces and awkward states.
- Five workflow callers of the shared `Frazzled-Productions/.github` workflows at `@v1`, on
  GitHub-hosted runners (the repo is public, so no billed minutes): `openspec-archive.yml` (archives
  on `qa`, PR into `qa`, `required-contexts` = the `qa-staging` checks plus the two new ones),
  `openspec-overlap.yml` (`base-branch: qa`), `openspec-required.yml` and `context-budget.yml` (PRs
  into `qa` only).
- The docs fast path, merged into `ci.yml`: the `changes` job treats `openspec/**` as docs, so the
  `test` job skips the build for OpenSpec-only PRs, as it already does for Markdown and `docs/`.
- `.github/context-budget.txt`, seeded at today's counts (AGENTS.md 229, CLAUDE.md 1,
  `.claude/agents/*.md` 1018).
- AGENTS.md gains the kit's "OpenSpec" and "Delegated work and the stall watcher" sections, with
  `main` read as `qa`; `scripts/lint-agents-size.mjs` ceilings go from 190 lines / 22 KiB to
  240 lines / 26 KiB to fit them (26 KiB was the ceiling before 14 October 2026, still well under the
  32 KiB truncation point).

No app behaviour changes, so `skip_specs: true` and no `specs/` folder.

## Also touches

- **Review and quiz screens, Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because no app code changes.
- **Guest mode, cloud sync and Supabase migrations:** no change, because no `lib/`, `app/api/` or `db/` file changes.
- **Superuser mode and QA-seed scenarios:** no change, because no app code changes.
- **Locales and pseudo-locale:** no change, because no catalogue changes.
- **Push notifications and the service worker:** no change, because no app code changes.
- **Sign-in, privacy notice and sub-processors:** no change; the new workflows send nothing outside GitHub.
- **Accessibility:** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no change and no fragment, because nothing user-facing changes (`changelog-gate` only asks for one on `app/`, `components/` or `lib/`).
- **CI and GitHub Actions:** four new workflows (above); `ci.yml`'s `changes` filter gains `!openspec/**`; the archive bot's 30-minute scheduled job adds short hosted runs (free on a public repo). After this PR shows both new checks green, the `qa-staging` ruleset (16499371) adds "OpenSpec required / OpenSpec required" and "Context budget / Context budget" (Fraser approved, 23 October 2026). `main-protection` is unchanged.
- **AGENTS.md size lint:** ceilings raised (above).

## Removes

Nothing, because this adds the OpenSpec process alongside the existing gates; `lint:agents-size` stays
(it also caps bytes, which the context budget does not).

## Out of scope

- Baseline specs for existing behaviour (written on touch, per the house rules).
- Requiring the new checks on `main` (promotions carry many changes and need none of their own).
- `orca.yaml` (its own change, `add-orca-yaml`).

## Owner decisions relied on

- 21 October 2026: OpenSpec for every change in every repo except local-ai-trial.
- 22 October 2026: never archive by hand; the archive bot approves its own PR's held checks.
- 23 October 2026: every repo adopts at its next change, with the shared checks and the kit.
- 23 October 2026: the ops#79 plan for Poké Memory (hosted callers on `qa`, ruleset edit once green).

## Clarifications

- 2026-10-23 Q: Adopt OpenSpec in Poké Memory before its `orca.yaml`? A: Yes (Fraser, ops#79).
- 2026-10-23 Q: Add the two checks to `qa-staging` once this PR shows them green? A: Yes (Fraser, ops#79 section 4).
