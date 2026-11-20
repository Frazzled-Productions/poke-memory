## Why

Fraser ruled on 20 November 2026 (about 13:55 UTC) that QA moves to Cloudflare first, then the
Supabase and Vercel accounts are deleted the same day. `qa.pokememory.com` was still served by the
old Vercel qa deploy (behind Vercel login, on the Supabase project `poke-memory-qa`) through a
wildcard DNS record, and the GitHub repo still held the Supabase and Vercel secrets that deploy used.

Fixes: none (a step of #2393; Refs ops #610).

## What Changes

- **`qa.pokememory.com` is a Worker Custom Domain on `poke-memory-preview`**, attached in
  Cloudflare and deliberately not a route in `wrangler.jsonc` (as for `pokememory.com`). The
  wildcard `*.pokememory.com` CNAME to Vercel and the `_vercel` verification TXT record are deleted;
  nothing else on the zone used them (old values recorded on #2393).
- **The preview Worker's `BETTER_AUTH_URL` is `https://qa.pokememory.com`**, so username sign-in
  works there. The workers.dev address and the per-PR aliases stay trusted origins
  (`trustedOriginsFor`), so sign-in keeps working on them.
- **Obsolete secrets go**: `QA_NEXT_PUBLIC_SUPABASE_URL`, `QA_NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `QA_SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN` and
  `VERCEL_DEPLOY_HOOK_URL`. No workflow on `qa` or `main` reads any of them.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no
  change, no app code changes.
- **Guest mode (localStorage), cloud sync and Supabase migrations:** no change. The preview D1
  database holds only the two seeded `preview-tester-*` accounts (checked 20 November 2026).
- **Superuser mode and QA-seed scenarios:** no change; QA now happens on `qa.pokememory.com` against
  the preview database.
- **Locales:** no change.
- **Push notifications and the service worker (offline):** no change. The preview Worker still has
  no Cron Triggers and no VAPID private key.
- **Sign-in:** the preview Worker's base URL changes as above. OAuth stays off on the preview Worker
  (it has no GitHub or Google client secrets).
- **Privacy notice and sub-processors:** no change; Cloudflare is already the processor.
- **Accessibility, README screenshots:** no change.
- **Changelog fragments and the release:** no fragment, nothing a player sees.
- **CI and GitHub Actions:** no workflow change. `deploy.yml` still uploads preview versions only
  when a preview token exists; the preview Worker itself is deployed by hand from `qa`.

## Removes

- The Vercel qa deploy's DNS (the wildcard CNAME and `_vercel` TXT record) and the seven GitHub
  secrets above.

## Out of scope

- Deleting the Supabase and Vercel projects (the main session does it after a final dump).
- `vercel.json` and `scripts/vercel-config.test.mjs`: they keep a still-connected Vercel Git
  integration from rebuilding the site and go once the Vercel project is deleted.
- Historical mentions of Supabase and Vercel (old migrations, the CHANGELOG, archived changes, the
  one-off copy script).

## Decisions relied on

- Fraser, 20 November 2026, about 13:55 UTC: move QA to Cloudflare first, then delete Supabase and
  Vercel today.
- Fraser lets agents merge into `qa` when CI is green (global rules, 26 October 2026).

## Clarifications

- 2026-11-20: Remove the wildcard record? Yes, only if nothing else needs it; `www.pokememory.com`
  resolved through it but was not served (TLS mismatch), so nothing did.
