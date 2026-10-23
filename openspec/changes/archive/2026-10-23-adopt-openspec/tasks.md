## 1. Adoption

- [x] 1.1 `openspec init --tools claude` with the core plus verify profile; em dashes replaced and the "do not archive by hand" note added. Verify: `npm run lint:em-dash` exits 0.
- [x] 1.2 `openspec/config.yaml` from the kit with Poké Memory's surfaces. Verify: `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0.
- [x] 1.3 The five callers (archive, overlap, required, budget, docs fast path in `ci.yml`). Verify: the archive caller's `required-contexts` matches, line for line, the `qa-staging` list after the ruleset edit.
- [x] 1.4 `.github/context-budget.txt` and the two AGENTS.md sections; size lint ceilings raised. Verify: `node scripts/lint-agents-size.mjs` exits 0; "Context budget / Context budget" green on this PR.
- [x] 1.5 Both new checks report on this PR into `qa`. Verify: "OpenSpec required / OpenSpec required" and "Context budget / Context budget" green in the PR's checks.
- [x] 1.6 Add both checks to `qa-staging` (16499371), owner approved. Verify: `gh api repos/Frazzled-Productions/poke-memory/rulesets/16499371` lists both.
- [x] 1.7 After merge, "Run workflow" on OpenSpec archive. Verify: the run is green and no "all changes" issue opens.
