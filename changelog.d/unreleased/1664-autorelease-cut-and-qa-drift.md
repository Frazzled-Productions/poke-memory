---
kind: fixed
issue: 1664
---
- Release cut (`auto-release.yml`) no longer fails on changelog fragments that carry an extra `issue:` front-matter key. The cut and the PR-time lint now share one parser (`scripts/lib/changelog-fragment.mjs`), so they can never disagree on what a valid fragment is.
- Added a daily `qa-drift-check` job that detects when `qa` was left un-reset after a release (main no longer an ancestor of qa) and opens a tracking issue, instead of the drift surfacing as merge conflicts at the next promotion.
