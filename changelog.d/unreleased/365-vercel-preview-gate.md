---
kind: changed
---
- Vercel preview deployments are now gated on a green CI run plus an LGTM auto-review verdict on the same commit, eliminating wasted builds on intermediate fix commits. Maintainers can comment `/preview` on a PR to bypass the gate for mid-iteration peeks.
