---
kind: fixed
---
- Visual regression diffs now download from CI artifacts: the `playwright-report/` upload was silently empty because the CI-only `github` reporter writes annotations rather than the HTML report directory. Run both reporters in CI and fail the upload loud if the directory is missing.
