## 1. Domain and DNS

- [x] 1.1 Record the old `*.pokememory.com` CNAME and `_vercel` TXT on #2393 before the change (verified: issue comment of 20 November 2026)
- [x] 1.2 Delete both records and attach `qa.pokememory.com` as a Worker Custom Domain on `poke-memory-preview` (verified: Cloudflare API lists the domain, `curl https://qa.pokememory.com/` answers from Cloudflare)

## 2. Sign-in on the qa address

- [x] 2.1 Test first: `lib/cron/wranglerConfig.test.ts` "the preview Worker's sign-in base URL is qa.pokememory.com" failed on the old workers.dev value
- [x] 2.2 Set `env.preview.vars.BETTER_AUTH_URL` to `https://qa.pokememory.com` in `wrangler.jsonc` (verified: the test passes)
- [x] 2.3 Deploy the preview Worker from this branch (version a483f522) and sign in with a username on `qa.pokememory.com` (verified 20 November 2026: sign-up, `/sign-in/username` and `/get-session` all 200 with Origin qa.pokememory.com; the throwaway test user was then deleted)

## 3. Secrets

- [x] 3.1 Confirm no workflow on `qa` or `main` reads the seven Supabase and Vercel secrets (verified: `git grep` on both branches finds none)
- [x] ~~3.2 Delete them after this PR merges (verified: `gh secret list`)~~ Moved to #2393
