# Tasks

## 1. Caller

- [x] 1.1 Set `skip-not-started: true` in `.github/workflows/openspec-archive.yml` and correct its header. Verified by `actionlint` exit 0 on the file.
- [x] 1.2 Prove it against this repo's real `openspec/` before merge. Verified by running the shared workflow's step script locally (v1.9.0 tools, local bare origin, fake `gh`, no GitHub writes) on `origin/qa` with the input on and off: both stop loudly at `harden-push-delivery` (12 of 13 ticked), so the skip changes nothing for a partly ticked change.
- [x] ~~1.3 After merge, the next archive run is green once `harden-push-delivery` is resolved, and names any not-started change it leaves in place.~~ Moved to #2376 (6 November 2026)
