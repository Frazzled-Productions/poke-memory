---
kind: fixed
issue: 2115
---
- The streak-at-risk push now reads every candidate's streak history a page at a time, so at scale the last users' latest days are no longer truncated by the 1000-row API cap and no longer trigger a false nudge.
