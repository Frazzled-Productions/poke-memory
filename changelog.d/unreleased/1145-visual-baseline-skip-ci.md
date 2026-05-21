---
kind: fixed
---
- PRs opened by the Visual Baseline Update workflow now run the full required CI check set on open. The regen commit no longer carries `[skip ci]`, and `visual-regression.yml` skips baseline-only diffs via `paths-ignore` instead.
