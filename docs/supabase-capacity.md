# Supabase capacity & launch-readiness assessment

Issue [#677](https://github.com/fbrookhouse/poke-memory/issues/677) — verify the Supabase
project can absorb a public-launch traffic spike before posting publicly.

Assessment date: 2026-05-16. Project ref: `nvxvvtvnthsgdxgksmju`.

**Verdict: launch-ready.** No blocking issues. The advisor warnings are all
non-material — the `SECURITY DEFINER`-function lints are intentional design
choices, and the leaked-password lint does not apply to this app's auth model.
Details below.

## 1. Connection model — PostgREST, no direct Postgres connection

The app does **not** open direct Postgres connections in production. There is
no pooler-vs-direct-connection question to resolve, because no production code
path speaks the Postgres wire protocol at all.

- Both Supabase clients are constructed via `@supabase/ssr`:
  - `lib/supabase/client.ts` — `createBrowserClient` for browser code.
  - `lib/supabase/server.ts` — `createServerClient` for Server Components,
    Server Actions, and Route Handlers.
- Both are configured solely with `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The URL is the project's HTTPS API endpoint
  (`https://nvxvvtvnthsgdxgksmju.supabase.co`), not a Postgres connection
  string.
- All sync traffic — per-grade upsert, unload beacon, background pulls, the
  side-channel auto-syncs, the Stats-page force-pull, and the
  `reset_all_progress` RPC — goes through the JS client over **PostgREST**
  (`/rest/v1/...`), i.e. stateless HTTPS requests. Each request is a short-lived
  HTTP call; PostgREST manages its own internal Postgres connection pool
  server-side.

**Direct-connection audit.** `DATABASE_URL` and the `pg` driver appear only in:

- `lib/sync/integration/**` — the opt-in integration-test harness
  (`apply-migrations.test.ts`, `rls.test.ts`, `regression-trigger.test.ts`,
  `setup.ts`, `applyMigrations.ts`). These run against a local `postgres:15`
  container in CI, never against the production Supabase project.
- `vitest.config.ts` — wiring for that same test project.

No application module imports `pg` or reads `DATABASE_URL`. The HTTP/PostgREST
model means the launch spike manifests as a burst of stateless HTTPS requests
against the API gateway, not as a stampede of Postgres connections — the
classic connection-exhaustion failure mode does not apply here.

## 2. Plan limits vs a plausible launch spike

Per project memory the project is on the **Free tier**, and the live numbers are
consistent with that (Postgres `max_connections = 60`, the Free-tier Micro
instance default). Free-tier headline limits and current usage:

| Resource | Free-tier limit | Current usage | Headroom |
|---|---|---|---|
| Database size | 500 MB | 11 MB | Ample (~2 %) |
| Egress / bandwidth | 5 GB / month | Well under | Ample |
| Monthly active users (Auth) | 50,000 MAU | 3 users | Ample |
| Postgres connections | `max_connections = 60` | 12 active (as of the assessment date, 2026-05-16) | Sufficient (see note) |
| Project pausing | Paused after 7 days of inactivity | n/a (active project) | — |

Sizing against a plausible spike:

- **Storage.** Each authenticated user's footprint is small — `card_reviews` is
  roughly one row per `(card_type, subject_key)` (low thousands of rows at most
  for a completionist), plus `grade_log` (one row per grade), `streak_days`
  (one row per active day), and a single `user_settings` row. The current
  three-user dataset is 11 MB total. Even a spike onboarding several thousand
  users would stay comfortably inside the 500 MB Free-tier ceiling; storage is
  not a launch risk.
- **Connections.** Because the app uses PostgREST over HTTPS rather than direct
  connections, the 60-connection ceiling is consumed by Supabase's own
  server-side services (PostgREST, Auth, Realtime, etc.), not by app clients.
  A burst of concurrent users translates into queued HTTPS requests handled by
  PostgREST's internal pool, not 1-connection-per-user exhaustion. This is the
  correct architecture for absorbing a spike on a small instance.
- **Bandwidth.** Sync payloads are small JSON documents (per-grade upserts and
  full-state pulls of a few thousand rows at most). Sprites are **self-hosted
  static assets** under `public/sprites/pokemon/`, served from the Vercel
  deployment — they do **not** count against Supabase egress. The 5 GB/month
  Free-tier egress budget is therefore spent only on sync JSON, which is cheap
  per user.

**Residual risk / watch items.**

- A *very* large, sustained spike (tens of thousands of simultaneous sign-ins)
  could saturate the shared Free-tier compute (CPU/IO on the Micro instance)
  before any hard limit is hit — symptom would be elevated API latency, not
  errors. The mitigation is a one-click upgrade to a paid compute tier if
  launch-day metrics show sustained high latency; no code change is required.
- The Free tier pauses a project after 7 days of inactivity. Not a launch-spike
  risk, but worth knowing: keep the project active in the run-up to launch.

For a realistic launch of this app (an indie spaced-repetition tool — a spike
measured in hundreds-to-low-thousands of users, not a viral millions-scale
event) the Free tier has sufficient headroom. The recommendation is to launch on
Free and watch the Supabase dashboard's compute/latency graphs on launch day,
upgrading reactively only if sustained latency appears.

## 3. Advisor results

`get_advisors` was run for both `security` and `performance`.

### Performance — no issues

`get_advisors(performance)` returned an empty lint list. No missing indexes, no
unindexed foreign keys, no slow-query warnings.

### Security — warnings, all non-material

The `SECURITY DEFINER`-function lint count depends on what has merged: today the
advisor reports two warnings, and once issue [#697](https://github.com/fbrookhouse/poke-memory/issues/697)
(PR #728) lands it becomes three. The two `SECURITY DEFINER`-class lints —
`reset_all_progress` and, after #728, `delete_account` — are both intentional;
the leaked-password lint does not apply.

1. **`reset_all_progress` is a `SECURITY DEFINER` function callable by signed-in
   users**
   ([lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).
   **Intentional — no action.** This is the deliberate design from migration
   `018_reset_all_progress_rpc.sql`: the destructive "Reset all progress" path
   is centralised in one `SECURITY DEFINER` function that explicitly checks
   `auth.uid()` and raises `insufficient_privilege` when the session is
   unauthenticated. It deletes only `WHERE user_id = uid`, so a user can wipe
   their own data and no one else's. `EXECUTE` is revoked from `public`/`anon`
   and granted only to `authenticated` (PostgreSQL preserves these grants across
   `CREATE OR REPLACE FUNCTION`, so migration 026 recreating the function does
   not re-issue the GRANT), and `search_path` is pinned to `''`. This is the
   canonical Supabase pattern for a self-service destructive RPC and is
   documented in AGENTS.md. The advisor flags every `SECURITY DEFINER` function
   it can see; here the warning is expected and correct to leave as-is.

2. **`delete_account` is a `SECURITY DEFINER` function callable by signed-in
   users** (same
   [lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable);
   appears only once issue [#697](https://github.com/fbrookhouse/poke-memory/issues/697)
   / PR #728 and its migration `027_delete_account_rpc.sql` have merged — the
   migration is already applied to the live project).
   **Intentional — no action.** It gets the same treatment as
   `reset_all_progress`: an explicit `auth.uid()` guard, deletion scoped to the
   caller's own data only, `EXECUTE` granted solely to `authenticated`, and a
   pinned `search_path`. The lint is expected and correct to leave as-is.

3. **Leaked-password protection disabled**
   ([password-security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).
   **Does not apply — no action.** This feature checks user-chosen passwords
   against HaveIBeenPwned. The app uses **OAuth only** (`signInWithOAuth` with
   GitHub and Google in `lib/auth/actions.ts`) — there is no email/password
   sign-up flow, so there are no passwords for this protection to guard.
   Enabling it would have no effect. If a password provider is ever added, this
   should be enabled at that point.

None of these warnings block launch; no migration or fix is warranted.

## 4. RLS confirmation

`list_tables` reports four tables in the `public` schema, **all with RLS
enabled**:

| Table | RLS enabled | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `card_reviews` | yes | yes | yes | yes | yes |
| `user_settings` | yes | yes | yes | yes | yes |
| `streak_days` | yes | yes | yes | — (append-only) | — (append-only) |
| `grade_log` | yes | yes | yes | — (append-only) | — (append-only) |

Every policy scopes rows to the calling user. The expression on each is
`(SELECT auth.uid()) = user_id` — used as `USING` for SELECT/UPDATE/DELETE and as
`WITH CHECK` for INSERT. The `(SELECT auth.uid())` wrapping is the
init-plan-optimised form from migration `024_rls_init_plan_select_auth_uid.sql`,
which evaluates `auth.uid()` once per query rather than once per row.

`streak_days` and `grade_log` deliberately have **no** UPDATE or DELETE policies
— they are append-only audit/history tables, and migration 018 dropped those
policies so a future client bug cannot silently wipe history. Destructive wipes
go exclusively through the `reset_all_progress` RPC. Every table also has a
foreign key on `user_id` referencing `auth.users(id)`.

There is no RLS gap. A spike of new users cannot read or write each other's
rows.

## Summary

| Check | Result |
|---|---|
| Connection model | PostgREST over HTTPS; no direct Postgres connection in production code |
| Plan limits vs spike | Free tier; ample storage/bandwidth/MAU headroom; watch compute latency on launch day |
| Performance advisors | Clean — no lints |
| Security advisors | All non-material (intentional `SECURITY DEFINER` RPCs — two today, three once #728 lands; password protection N/A for OAuth-only) |
| RLS | Enabled on all four tables, every policy scoped to `auth.uid()` |

The Supabase project is launch-ready on the Free tier. The single operational
recommendation is to watch the dashboard's compute/latency graphs on launch day
and upgrade compute reactively if sustained latency appears — a configuration
change, not a code change.
