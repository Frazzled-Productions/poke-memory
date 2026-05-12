---
kind: added
---
- Plan staleness gate: `/go` now refuses to implement when `origin/main` has moved into planned files since the plan was written. A new `/replan` command re-runs planning against the current tree.
