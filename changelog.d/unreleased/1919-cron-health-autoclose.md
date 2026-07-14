---
kind: fixed
issue: 1919
---
- The cron-health monitor now finds its own open tracking issues again: repeat failures update the existing issue in place instead of filing duplicates, and a recovered workflow's issue closes automatically on the next healthy run. The broken `gh issue list --search` marker lookup (the marker's colon parsed as a search qualifier and matched nothing) is replaced with the repo-standard local jq marker match.
