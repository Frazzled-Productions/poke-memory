## Why

Supabase is removing the legacy `anon` and `service_role` keys (late 2026; we treat 1 December 2026
as the deadline). Poké Memory reads only those legacy keys today, so it would stop talking to
Supabase when they go. This is step 1 of #2162: read the new keys first, with the legacy keys as a
fallback, so the code ships before any env change and keeps working while both are set.

## What Changes

- New `lib/supabase/keys.ts`: `supabasePublishableKey()` reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  else `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `supabaseSecretKey()` reads `SUPABASE_SECRET_KEY`, else
  `SUPABASE_SERVICE_ROLE_KEY`. An empty value counts as unset.
- The browser and server Supabase clients (`lib/supabase/client.ts`, `lib/supabase/server.ts`) read
  the publishable key through the helper.
- The five service-role routes (Discord digest and notify, feedback, push send-daily and
  send-streak-nudge) read the secret key through the helper.
- `.env.local.example` documents the new names. A changelog fragment (`kind: security`) is added.
- New tests: `lib/supabase/keys.test.ts` (the helper) and `lib/supabase/clients.test.ts` (both clients
  use the new key and fall back to the legacy one).

Nothing changes in production until the new env vars are set (#2162 steps 2 to 4, Fraser's).

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because no UI code changes; they use the same Supabase clients, which now accept either key.
- **Guest mode (localStorage):** no change, because guest mode does not talk to Supabase.
- **Cloud sync and Supabase migrations (both projects):** sync goes through the same clients, now reading the key through the helper; no migration, because no schema changes. The pg_net calls (migrations 031, 042) use `cron_shared_secret`, not these keys.
- **Superuser mode and QA-seed scenarios:** no change to the app; `scripts/qa-seed-cloud.ts` still reads `SUPABASE_SERVICE_ROLE_KEY` (deferred to #2162 step 6, a local QA tool).
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy changes.
- **Push notifications and the service worker (offline):** `send-daily` and `send-streak-nudge` read the secret key through the helper; their misconfigured (503) response is unchanged. The service worker is unchanged.
- **Sign-in:** the browser and server clients that sign in now prefer the publishable key; behaviour is the same with either key.
- **Privacy notice and sub-processors:** no change, because Supabase is already listed and no new data flows.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** one fragment, `changelog.d/unreleased/2162-supabase-new-keys.md` (`kind: security`, a patch).
- **CI and GitHub Actions:** no workflow change. The e2e `QA_NEXT_PUBLIC_SUPABASE_ANON_KEY` secret keeps working through the fallback; adding the publishable one is #2162 step 3.

## Removes

Nothing yet, because the legacy keys must keep working until Fraser switches the env (#2162 steps 2
to 4). The direct `process.env` reads of the legacy keys in the seven app files are replaced by the
helper; the fallbacks themselves go in #2162 step 6.

## Out of scope

- Creating the new keys and setting them in Vercel and Actions (#2162 steps 2 and 3, Fraser).
- Disabling the legacy keys and removing the fallbacks (#2162 steps 5 and 6).
- `scripts/qa-seed-cloud.ts` and a shared service-role client in `lib/supabase/admin.ts` (#2162
  follow-ups).

## Owner decisions relied on

- 17 October 2026: #2162's plan, step 1 first: read the new keys with a fallback to the legacy ones,
  shipping with no env change (Fraser, #2162 and PR #2163).
- 23 October 2026: finish PR #2163 with tests that cover the fallback, and an OpenSpec change for it
  (Fraser).

## Clarifications

- 2026-10-17 Q: Ship the code before the env change? A: Yes, with fallbacks so nothing changes until the new keys are set (Fraser, #2162).
- 2026-10-23 Q: Finish PR #2163 with fallback tests and an OpenSpec change, then merge into `qa`? A: Yes (Fraser, 23 October 2026).
