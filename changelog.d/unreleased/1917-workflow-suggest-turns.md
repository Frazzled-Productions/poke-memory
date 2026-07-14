---
kind: fixed
issue: 1917
---
- Weekly workflow digest cron no longer dies at the agent turn cap: the 30-day signal gather (retro comments, review feedback, WIP commits, merged-PR bodies) is pre-fetched deterministically in a shell step and the agent reads prepared files.
