## 1. Key helper

- [x] 1.1 `lib/supabase/keys.ts` with `supabasePublishableKey()` and `supabaseSecretKey()`, each preferring the new key and treating an empty value as unset. Verify: `lib/supabase/keys.test.ts` (new key wins, legacy fallback, empty new key, neither set).

## 2. Callers

- [x] 2.1 The browser and server clients read the publishable key through the helper. Verify: `lib/supabase/clients.test.ts`, written failing first: it fails against a legacy-only read ("uses the new publishable key", 2 tests) and against a no-fallback read ("falls back to the legacy anon key", 2 tests), and passes on this change; the browser client still throws when neither key is set.
- [x] 2.2 The five service-role routes read the secret key through the helper. Verify: the existing feedback, Discord and push route suites pass (their misconfigured responses unchanged).
- [x] 2.3 `.env.local.example` names the new keys and the changelog fragment is added. Verify: `changelog-gate` green.

## 3. Gates

- [x] 3.1 Diff coverage at or above 90%. Verify: "Test coverage report" green (it was 86.67%, with `lib/supabase/client.ts:7` and `lib/supabase/server.ts:12` uncovered).
- [x] 3.2 `OPENSPEC_TELEMETRY=0 openspec validate supabase-new-keys --strict` exits 0.
