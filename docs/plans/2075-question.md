# #2075: open questions for Fraser

The fix itself needed no decision and ships in the same commit as this file. `.github/dependabot.yml` now ignores `typescript` semver-major updates on the npm entry, and `scripts/dependabot-config.test.mjs` fails if the rule goes missing or gets wider while `package.json` is below typescript 7. It also fails if the rule is still there once `package.json` reaches 7. The questions below are the scope and housekeeping calls the issue raised. They were left alone deliberately.

## Q1. Should `@types/node` follow the Node 24 runtime?

The runtime is Node 24: `.nvmrc`, `package.json` `engines.node` (`24.x`), the prebuild/preinstall guard, CI and Vercel all say so. `@types/node` is `^26`, locked at 26.2.0. So `tsc` accepts Node 25 and 26 APIs that do not exist at runtime. No such call site exists today (the issue checked), so this is a latent risk, not a live bug.

- **A. Pin `@types/node` to `^24` and add a second semver-major ignore rule for it. (Recommended.)** The types then match the runtime, so a Node 25+ only API becomes a compile error instead of a production crash. The cost is lockfile churn from a downgrade, which has to be regenerated with `npm install` under Node 24. The downgrade may also surface typecheck fallout, because `@types/node` 24 pulls a different `undici-types` line, so `fetch`/`Response` typings can shift. After that, `@types/node` needs a manual bump in the same change as every `.nvmrc` bump.
- **B. Keep `^26` on purpose** and say so in a one-line `dependabot.yml` comment. No work and no churn, but the gap stays and nothing flags a Node 25+ API.
- **C. Defer.** Do nothing now and revisit when `.nvmrc` next moves. This PR stays a pure config fix, but this kind of drift tends to be forgotten (compare #1921).

Trade-off: A turns a silent runtime risk into a compile-time error, at the cost of one churn PR and a manual step per Node major. B and C cost nothing now and leave the risk in place.

## Q2. Only if Q1 = A: add a forcing function so the pin cannot drift?

- **(a) Extend `scripts/check-node-version-drift.mjs`** so the `@types/node` major must equal the `.nvmrc` major, and add `package.json` to `node-version-drift.yml`'s trigger paths. (Recommended.) This matches the repo's single-source-of-truth rule. Without it, the next `.nvmrc` bump leaves the types behind silently, the same class of bug #1575 fixed for workflows. The cost is about 20 lines plus a test, and the workflow edit needs a mandatory workflow-expert review.
- **(b) Rely on the `dependabot.yml` comment**, or file the check as a separate issue. This keeps the change small, but the protection is only as good as the person reading the comment.

## Q3. How should this land?

- **qa, the normal route. (Recommended.)** Dependabot reads `dependabot.yml` from the default branch (`main`) only, so the rule starts working at the next `qa -> main` promotion. Until then Dependabot keeps offering 7.x and #2037 stays red. That is visible but harmless.
- **Hotfix PR into `main`.** The rule works from the next Dependabot run, but this needs your `hotfix` label and a backmerge into `qa`, which is a lot of ceremony for a devDependency.

## Q4. GitHub housekeeping (these change shared state, so they are yours to approve)

- **#2037:** leave it open so Dependabot can rewrite it after promotion, and close it only if it still carries typescript 7 after the first run. (Recommended.) If you close it now, Dependabot opens the same typescript 7 PR again each Monday until the config reaches `main`.
- **#1921:** add typescript-eslint as a third blocker (qa locks 8.59.2, whose peer range is `typescript >=4.8.4 <6.1.0`; #2037's install pulled 8.69.0, which rejects TS 7 outright), and add "remove the `typescript` ignore rule in `.github/dependabot.yml`" to its revisit steps. A comment keeps your original text intact. Editing the body keeps the checklist in one place.
- **Heads-up, unverified:** it is not established whether a rule scoped by `update-types` also holds back Dependabot *security* PRs. GitHub's options reference and its security-updates overview do not say either way (checked 2026-09-17). If it does not, a `typescript` advisory fixed only in 7.x would still produce a red PR like #2037. That is unlikely for a devDependency compiler, so no change is proposed, but if such a PR appears, this is the reason.
- **Heads-up, out of scope here:** qa's typescript-eslint peer range stops below 6.1, so a future typescript 6.1 minor, which the new rule still lets through, could turn the tooling PR red in the same way.
