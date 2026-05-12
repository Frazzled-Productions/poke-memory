---
kind: fixed
---
- `/fix` cycle no longer hits `--max-turns` before posting `auto-review:2`: the CI-wait polling loop now runs as a single Bash invocation instead of one agent turn per iteration, and `--max-turns` raised from 80 to 120 for headroom on large punch lists.
