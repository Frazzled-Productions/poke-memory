## 1. Spec on touch

- [x] 1.1 Write the baseline for username sign-up from `lib/auth/actions.ts` and its tests. Verified by `openspec validate --strict`.

## 2. Build

- [x] 2.1 Rewrite `lib/auth/actions.test.ts` for the new path, failing first. Verified: 17 failed, 15 passed, exit 1, each with `Cannot destructure property 'data'` because the action still called `signUp`.
- [x] 2.2 Create accounts with `admin.createUser`, sign in, then insert. Verified by `lib/auth/actions.test.ts`: 32 passed, exit 0.
- [x] 2.3 Answer `signup_failed` when the secret key is missing. Verified by the test "returns signup_failed without creating an account when no secret key is set".
- [x] 2.4 Delete the new user when the follow-up sign-in fails. Verified by the two "removes the new user" tests.
- [x] 2.5 Confirm behaviour in both setting states on a local auth server at the deployed version. Verified: 12 of 12 checks, exit 0 (see design.md).
- [x] 2.6 Update `e2e/auth-real.spec.ts`, `.github/workflows/ci.yml` and `.env.local.example`. Verified by `npm run lint` and `tsc --noEmit`.
- [x] 2.7 Add the changelog fragment. Verified by `npm run lint:changelog`.
- [x] 2.8 Log a missing key, a failed create and a failed clean-up delete, with no credentials, from the final review. Verified by the "server log on failures" tests: 3 failed on the missing log first, then all passed.

## 3. Owner steps

- [x] 3.1 ~~Add `QA_SUPABASE_SECRET_KEY` to GitHub, then let `e2e-real-auth` run~~ Moved to ops #398 (2026-11-02)
- [x] 3.2 ~~Confirm the secret key on Vercel production and preview~~ Moved to ops #398 (2026-11-02)
- [x] 3.3 ~~Change the Supabase setting on QA, then production~~ Moved to ops #398 (2026-11-02)
