## 1. Build

- [x] 1.1 Delete `vercel.json` and `scripts/vercel-config.test.mjs`. Verified: `git grep vercel-config` finds nothing outside history
- [x] 1.2 Delete the copy scripts, their test and the `pg` and `@types/pg` dev dependencies. Verified: `git grep -n "copy-from-supabase\|compare-counts\|from \"pg\""` finds only this change; `npm test` passes
- [x] 1.3 Delete `docs/supabase-capacity.md`. Verified: no link to it remains (`git grep supabase-capacity`)
- [x] 1.4 Rename `supabase-expert` to `d1-expert` with every mention. Verified: `git grep supabase-expert` finds only CHANGELOG and archived changes
- [x] 1.5 `npm run lint`, `npx tsc --noEmit`, `npm test` and `openspec validate retire-supabase-vercel-leftovers --strict` pass (evidence in the PR body)
