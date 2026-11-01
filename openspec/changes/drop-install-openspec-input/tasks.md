## 1. Failing check first

- [x] 1.1 Before any edit, run `git grep -n install-openspec -- .github/workflows` and record that it finds the two lines (red). Verify: output and exit code pasted in the PR.

## 2. Drop the input

- [x] 2.1 Delete `install-openspec: true` from `.github/workflows/openspec-archive.yml` and `.github/workflows/openspec-overlap.yml`. Verify: the 1.1 check now finds nothing, and `git diff --numstat origin/qa -- .github` shows one deleted line in each file and nothing else.
- [x] 2.2 Both callers still meet the shared contract. Verify: at `v1` every required input is passed, no undefined one is passed and nothing reads the input, by parsing both workflow files at `v1`; `actionlint` exits 0 on both callers. Output in the PR.

## 3. Gates

- [x] 3.1 `OPENSPEC_TELEMETRY=0 openspec validate --all --strict` exits 0. Verify: exit code pasted in the PR.
- [x] 3.2 No em dash on added lines. Verify: `git diff origin/qa -U0 | grep '^+' | grep -c` for U+2014 prints 0.
- [x] 3.3 The new overlap caller runs for real. Verify: the "OpenSpec overlap" check on this PR passes, run link in the PR.
- [x] 3.4 Run `/opsx:verify drop-install-openspec-input` and `blast-radius`; fix or list what they find. Verify: their results in the PR.
