## Why

Row Level Security is the only thing keeping one user's rows from another: `anon` and `authenticated` hold every privilege on every `public` table. It is tested on `card_reviews` and `usernames` only, and nothing reads `relrowsecurity`, so a migration that adds a table without RLS passes CI (#2212, poke-memory finding 10 of the 1 November audit).

This is a test gap, not a live gap. A read-only catalogue query on both Supabase projects on 2 November 2026 showed all 8 `public` tables with RLS on, policies matching the migrations, and no views.

Spike only: it waits for Fraser.

Fixes: #2212

## What Changes

- New `lib/sync/integration/rls-coverage.test.ts`, with two parts:
  - **Catalogue:** every `public` table has RLS on and at least one policy, with `rate_limit_buckets` allowlisted for the policy rule only. Every table must be listed as a user table or allowlisted, so a new table fails until someone classifies it.
  - **Cross-user, over all seven user tables:** another user cannot SELECT, INSERT for, or UPDATE a row, a user cannot hand their own row to another user, and anon cannot SELECT.
- New capability `row-level-security`: a baseline of each table's policies, plus the CI rule.
- `docs/testing.md` and the new-table checklist in `docs/persistence.md` name the test.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because no app code changes.
- **Guest mode (localStorage):** no change, because guests do not reach Supabase.
- **Cloud sync and Supabase migrations (both projects):** no migration and no schema change. A future migration that adds a `public` table now fails `integration` until the table is classified in the test.
- **Superuser mode and QA-seed scenarios:** no change, because no app code changes.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy changes.
- **Push notifications and the service worker (offline):** no change. `push_subscriptions` is tested but not altered.
- **Sign-in:** no change. `usernames` is tested but not altered.
- **Privacy notice and sub-processors:** no change, because no data flow changes. `docs/dpia.md` R1 is stale; see Clarifications.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because users see nothing. The file sits under `lib/`, so the PR carries the `no-changelog` label.
- **CI and GitHub Actions:** no workflow change. `lib/sync/**` is already on the `integration-tests.yml` path filter, so the test runs on PRs touching sync or migrations. Open work that adds a table must classify it: see design.md.

## Removes

Nothing yet. `usernames-rls.test.ts` still proves things this file does not (anon INSERT, username CHECK constraints). `rls.test.ts` now overlaps this file completely; see Clarifications. The three tests that cannot fail are #2219.

## Out of scope

- Changing any RLS policy, on `qa` or live.
- Cross-user DELETE, and the three existing tests that cannot fail (#2219).
- Running the check against the live database in CI. That needs a credential in a new place.

## Owner decisions relied on

- Every change goes through OpenSpec (21 October 2026).
- Production settings and credentials change only on Fraser's explicit yes (17 October 2026). The live check was a read-only query.

## Clarifications

No grilling has happened yet; each line is an open call with a recommendation, dated 2026-11-02.

- **Include cross-user DELETE in this change?** Recommended: no, keep to the audit's SELECT, INSERT and UPDATE and do it in #2219 with the three tests that cannot fail. Alternative: add one more case here.
- **Delete `rls.test.ts`?** This file covers all four of its tests more strictly, but `docs/dpia.md` cites it. Recommended: yes, in #2219 together with the DPIA correction. Alternative: keep it and fix its UPDATE test.
- **Check views too?** A view in `public` runs as its owner and skips RLS, so this test would not see one. There are none on either live project. Recommended: leave it out until a migration proposes a view. Alternative: a one-line assertion that `public` holds no view.
- **Fail a table that relies on the live auto-enable?** Both live projects run an event trigger (`ensure_rls`) that turns RLS on for new `public` tables, which softens the audit's worst case. The test database has a no-op stub, so a migration that omits `ENABLE ROW LEVEL SECURITY` still fails here. Recommended: yes, as built, since `docs/persistence.md` already requires it in the migration.
- **Correct `docs/dpia.md` R1?** It says RLS covers "all four tables" and cites only `rls.test.ts`; the schema has eight. Recommended: yes, in a privacy review rather than this PR, because the DPIA is a formal document.
