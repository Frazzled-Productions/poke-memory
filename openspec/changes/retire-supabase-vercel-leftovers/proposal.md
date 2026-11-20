## Why

The Supabase and Vercel projects were deleted on 20 November 2026 (Fraser's ruling, ops #610). The
files #2406 kept on purpose until then now have no job: `vercel.json` and its test, the one-off
Supabase copy scripts, a capacity report on the deleted Supabase project, and an agent still named
after Supabase although it covers D1 and Better Auth (#2407).

Fixes: #2407

## What Changes

- Delete `vercel.json` and `scripts/vercel-config.test.mjs`.
- Delete `scripts/cloudflare/copy-from-supabase.mjs`, its test and `compare-counts.mjs`, and the `pg`
  and `@types/pg` dev dependencies only the copy script used. `lib/db/migrationTriggers.mjs` stays (the
  backup tests use it); only its comment changes.
- Delete `docs/supabase-capacity.md`.
- Rename the `supabase-expert` agent to `d1-expert` and update every mention (`WORKFLOW.md`,
  `.claude/agents/`, `.claude/commands/batch-issues.md`, a comment in `scripts/seed-pokemon.mjs`).
- Historical mentions stay: `db/migrations/`, the CHANGELOG and archived OpenSpec changes.

## Capabilities

### Modified Capabilities

- `hosting-and-data`: the two requirements describing the Supabase-to-D1 copy are removed.

## Impact

No running code, workflow or user-visible surface changes. The deleted scripts were never imported by
the app or a workflow (checked with `git grep`); `pg` was imported only by the copy script.

## Also touches

- Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new: no change,
  because no app code changes.
- Guest mode (localStorage), cloud sync: no change, because the sync path never used these files.
- Supabase migrations (both projects): no change; `db/migrations/` stays as history.
- Superuser mode and QA-seed scenarios: no change; `scripts/cloudflare/seed-preview.mjs` stays.
- Locales: no change, no strings touched.
- Push notifications and the service worker: no change.
- Sign-in: no change; copied accounts' bcrypt hashes are still verified by `lib/auth/password.ts`.
- Privacy notice and sub-processors: no change; they already name Cloudflare only.
- Accessibility: no change.
- README screenshots: no change.
- Changelog fragments and the release: none, because nothing user-facing changes.
- CI and GitHub Actions: no workflow changes; `npm test` loses the two deleted test files.

## Out of scope

Historical migrations, the CHANGELOG, archived OpenSpec changes and the DPIA's revision history.

## Owner decisions this relies on

- 20 November 2026: delete Supabase and Vercel now, without the 14-day fallback (ops #610).
- 20 November 2026: "the clean ups are approved" (this change).

## Removes

`vercel.json`, `scripts/vercel-config.test.mjs`, `scripts/cloudflare/copy-from-supabase.mjs`,
`scripts/cloudflare/copy-from-supabase.test.mjs`, `scripts/cloudflare/compare-counts.mjs`,
`docs/supabase-capacity.md`, the `pg` and `@types/pg` dev dependencies, the `supabase-expert` name,
and the two `hosting-and-data` copy requirements.

## Clarifications

- 20 November 2026: rename or delete the agent? Renamed to `d1-expert`, because the planner, data
  coder and batch command route schema work to it.
- 20 November 2026: Fraser approved the clean-ups ("the clean ups are approved").
